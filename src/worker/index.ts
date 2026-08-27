import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  parseLogEventV1,
  LogEventV1ValidationError,
} from "@contracts/log-event-v1/log-event-v1";
import { createRedisConnection } from "@/lib/server/redis";
import { getRuntimeConfig } from "@/lib/server/env";
import {
  deleteExpiredLogs,
  deleteExpiredDiagnostics,
  insertLogEvent,
  storeDeadLetter,
} from "@/lib/server/logs/log-repository";
import { collectMetricSnapshot } from "@/lib/server/metrics/metrics-collector";
import {
  addMetricSnapshot,
  ensureMongoCollections,
} from "@/lib/server/metrics/metrics-store";
import {
  extractEventPayload,
  getDeliveryCount,
  parseStreamReply,
  type StreamMessage,
} from "@/worker/stream-protocol";
import { ensurePostgresSchema } from "@/lib/server/postgres-schema";
import { getPostgresPool } from "@/lib/server/postgres";
import { getMongoClient } from "@/lib/server/mongo";
import { ingestionEnvelopeSchema } from "@/lib/server/logs/ingestion-envelope";
import { ensureDefaultAlertRules } from "@/lib/server/alerts/alert-rules";
import { evaluateAlerts } from "@/lib/server/alerts/alert-engine";
import { deliverDiscordNotifications } from "@/lib/server/alerts/discord";
import { deleteExpiredAlertHistory } from "@/lib/server/alerts/alert-store";

const config = getRuntimeConfig();
const redis = createRedisConnection();
let stopping = false;
const shutdownController = new AbortController();

async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.sendCommand([
      "XGROUP",
      "CREATE",
      config.LOG_STREAM_KEY,
      config.LOG_CONSUMER_GROUP,
      "0",
      "MKSTREAM",
    ]);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP"))
      throw error;
  }
}

async function deliveryCount(streamId: string): Promise<number> {
  const reply = await redis.sendCommand([
    "XPENDING",
    config.LOG_STREAM_KEY,
    config.LOG_CONSUMER_GROUP,
    streamId,
    streamId,
    "1",
  ]);
  return getDeliveryCount(reply);
}

function payloadHash(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

function safeIssues(error: unknown): Array<{ path: string; message: string }> {
  if (error instanceof LogEventV1ValidationError) return error.issues;
  return [
    {
      path: "",
      message:
        error instanceof SyntaxError
          ? "Invalid JSON event envelope"
          : "Permanent ingestion failure",
    },
  ];
}

async function finalizeStreamMessage(streamId: string): Promise<void> {
  await redis
    .multi()
    .xAck(config.LOG_STREAM_KEY, config.LOG_CONSUMER_GROUP, streamId)
    .xDel(config.LOG_STREAM_KEY, streamId)
    .exec();
}

async function processMessage(message: StreamMessage): Promise<void> {
  let rawPayload = "";
  try {
    rawPayload = extractEventPayload(message);
    const decoded: unknown = JSON.parse(rawPayload);
    const envelope = ingestionEnvelopeSchema.safeParse(decoded);
    const event = parseLogEventV1(
      envelope.success ? envelope.data.event : decoded,
    );
    const inserted = await insertLogEvent(
      event,
      envelope.success ? envelope.data.diagnostic : undefined,
    );
    if (inserted) {
      await redis.publish(
        config.LOG_LIVE_CHANNEL,
        JSON.stringify({ eventId: event.eventId, timestamp: event.timestamp }),
      );
    }
    await finalizeStreamMessage(message.id);
  } catch (error) {
    const permanent =
      error instanceof SyntaxError ||
      error instanceof LogEventV1ValidationError;
    if (!permanent) {
      console.error("Transient log ingestion failure", {
        streamId: message.id,
        error,
      });
      return;
    }

    const attempts = await deliveryCount(message.id);
    if (attempts < 5) return;

    await storeDeadLetter({
      streamId: message.id,
      payloadHash: payloadHash(rawPayload),
      failureCode:
        error instanceof SyntaxError ? "invalid_json" : "contract_rejected",
      validationIssues: safeIssues(error),
      deliveryCount: attempts,
    });
    await finalizeStreamMessage(message.id);
  }
}

async function processBatch(messages: StreamMessage[]): Promise<void> {
  for (const message of messages) await processMessage(message);
}

async function reclaimPending(): Promise<void> {
  const reply = await redis.sendCommand([
    "XAUTOCLAIM",
    config.LOG_STREAM_KEY,
    config.LOG_CONSUMER_GROUP,
    config.LOG_CONSUMER_NAME,
    "60000",
    "0-0",
    "COUNT",
    "50",
  ]);
  if (!Array.isArray(reply)) return;
  await processBatch(parseStreamReply([[config.LOG_STREAM_KEY, reply[1]]]));
}

async function ingestionLoop(): Promise<void> {
  while (!stopping) {
    await reclaimPending();
    const reply = await redis.sendCommand([
      "XREADGROUP",
      "GROUP",
      config.LOG_CONSUMER_GROUP,
      config.LOG_CONSUMER_NAME,
      "COUNT",
      "50",
      "BLOCK",
      "2000",
      "STREAMS",
      config.LOG_STREAM_KEY,
      ">",
    ]);
    await processBatch(parseStreamReply(reply));
  }
}

async function metricsLoop(): Promise<void> {
  while (!stopping) {
    const started = Date.now();
    try {
      await addMetricSnapshot(await collectMetricSnapshot());
    } catch (error) {
      console.error("Metrics collection failed", error);
    }
    await delay(Math.max(1_000, 30_000 - (Date.now() - started)), undefined, {
      signal: shutdownController.signal,
    }).catch(() => undefined);
  }
}

async function retentionLoop(): Promise<void> {
  while (!stopping) {
    try {
      const deleted = await deleteExpiredLogs(config.LOG_RETENTION_DAYS);
      const diagnosticsDeleted = await deleteExpiredDiagnostics();
      const alertsDeleted = await deleteExpiredAlertHistory(
        config.ALERT_RETENTION_DAYS,
      );
      console.info("Retention completed", {
        deleted,
        diagnosticsDeleted,
        alertsDeleted,
      });
    } catch (error) {
      console.error("Log retention failed", error);
    }
    await delay(24 * 60 * 60 * 1_000, undefined, {
      signal: shutdownController.signal,
    }).catch(() => undefined);
  }
}

async function alertLoop(): Promise<void> {
  while (!stopping) {
    const started = Date.now();
    try {
      await evaluateAlerts();
      await deliverDiscordNotifications();
    } catch (error) {
      console.error("Alert evaluation failed", error);
    }
    await delay(
      Math.max(
        1_000,
        config.ALERT_EVALUATION_INTERVAL_SECONDS * 1_000 -
          (Date.now() - started),
      ),
      undefined,
      { signal: shutdownController.signal },
    ).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  await ensurePostgresSchema();
  await redis.connect();
  await ensureConsumerGroup();
  await ensureMongoCollections();
  await ensureDefaultAlertRules();
  console.info("ops-worker ready");
  try {
    await Promise.all([
      ingestionLoop(),
      metricsLoop(),
      retentionLoop(),
      alertLoop(),
    ]);
  } finally {
    await Promise.allSettled([
      redis.isOpen ? redis.close() : Promise.resolve(),
      getPostgresPool().end(),
      getMongoClient().close(),
    ]);
  }
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  shutdownController.abort();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

main().catch((error) => {
  console.error("ops-worker failed", error);
  process.exitCode = 1;
});
