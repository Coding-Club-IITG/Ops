import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  parseLogEventV1,
  LogEventV1ValidationError,
} from "@contract/log-event-v1";
import {
  parseMetricEventV1,
  MetricEventV1ValidationError,
} from "@contract/metric-event-v1";
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
  shouldDeadLetter,
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
import {
  deleteExpiredMetricEvents,
  insertMetricEvent,
  storeMetricDeadLetter,
} from "@/lib/server/metrics/project-metrics";
import {
  deleteExpiredSecurityEvents,
  insertSecurityEvent,
  isFirstSeenSourceIp,
  storeSecurityDeadLetter,
} from "@/lib/server/security/security-repository";
import {
  checkCollectorDeadman,
  evaluateSecurityAlert,
} from "@/lib/server/security/security-alerts";
import type { SecurityEvent } from "@/types/security";

const config = getRuntimeConfig();
const redis = createRedisConnection();
const metricRedis = createRedisConnection();
const securityRedis = createRedisConnection();
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

async function ensureMetricConsumerGroup(): Promise<void> {
  try {
    await metricRedis.sendCommand([
      "XGROUP",
      "CREATE",
      config.METRIC_STREAM_KEY,
      config.METRIC_CONSUMER_GROUP,
      "0",
      "MKSTREAM",
    ]);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP"))
      throw error;
  }
}

async function ensureSecurityConsumerGroup(): Promise<void> {
  try {
    await securityRedis.sendCommand([
      "XGROUP",
      "CREATE",
      config.SECURITY_STREAM_KEY,
      config.SECURITY_CONSUMER_GROUP,
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
    if (!shouldDeadLetter(attempts)) return;

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

async function metricDeliveryCount(streamId: string): Promise<number> {
  const reply = await metricRedis.sendCommand([
    "XPENDING",
    config.METRIC_STREAM_KEY,
    config.METRIC_CONSUMER_GROUP,
    streamId,
    streamId,
    "1",
  ]);
  return getDeliveryCount(reply);
}

async function finalizeMetricMessage(streamId: string): Promise<void> {
  await metricRedis
    .multi()
    .xAck(config.METRIC_STREAM_KEY, config.METRIC_CONSUMER_GROUP, streamId)
    .xDel(config.METRIC_STREAM_KEY, streamId)
    .exec();
}

async function processMetricMessage(message: StreamMessage): Promise<void> {
  let rawPayload = "";
  try {
    rawPayload = extractEventPayload(message);
    const event = parseMetricEventV1(JSON.parse(rawPayload));
    await insertMetricEvent(event);
    await finalizeMetricMessage(message.id);
  } catch (error) {
    const permanent =
      error instanceof SyntaxError ||
      error instanceof MetricEventV1ValidationError;
    if (!permanent) {
      console.error("Transient metric ingestion failure", {
        streamId: message.id,
        error,
      });
      return;
    }
    const attempts = await metricDeliveryCount(message.id);
    if (!shouldDeadLetter(attempts)) return;
    await storeMetricDeadLetter({
      streamId: message.id,
      payloadHash: payloadHash(rawPayload),
      failureCode:
        error instanceof SyntaxError ? "invalid_json" : "contract_rejected",
      validationIssues:
        error instanceof MetricEventV1ValidationError
          ? error.issues
          : [{ path: "", message: "Invalid JSON metric event" }],
      deliveryCount: attempts,
    });
    await finalizeMetricMessage(message.id);
  }
}

async function processMetricBatch(messages: StreamMessage[]): Promise<void> {
  for (const message of messages) await processMetricMessage(message);
}

async function reclaimPendingMetrics(): Promise<void> {
  const reply = await metricRedis.sendCommand([
    "XAUTOCLAIM",
    config.METRIC_STREAM_KEY,
    config.METRIC_CONSUMER_GROUP,
    config.METRIC_CONSUMER_NAME,
    "60000",
    "0-0",
    "COUNT",
    "50",
  ]);
  if (!Array.isArray(reply)) return;
  await processMetricBatch(
    parseStreamReply([[config.METRIC_STREAM_KEY, reply[1]]]),
  );
}

async function metricIngestionLoop(): Promise<void> {
  while (!stopping) {
    await reclaimPendingMetrics();
    const reply = await metricRedis.sendCommand([
      "XREADGROUP",
      "GROUP",
      config.METRIC_CONSUMER_GROUP,
      config.METRIC_CONSUMER_NAME,
      "COUNT",
      "50",
      "BLOCK",
      "2000",
      "STREAMS",
      config.METRIC_STREAM_KEY,
      ">",
    ]);
    await processMetricBatch(parseStreamReply(reply));
  }
}

async function securityDeliveryCount(streamId: string): Promise<number> {
  const reply = await securityRedis.sendCommand([
    "XPENDING",
    config.SECURITY_STREAM_KEY,
    config.SECURITY_CONSUMER_GROUP,
    streamId,
    streamId,
    "1",
  ]);
  return getDeliveryCount(reply);
}

async function finalizeSecurityMessage(streamId: string): Promise<void> {
  await securityRedis
    .multi()
    .xAck(config.SECURITY_STREAM_KEY, config.SECURITY_CONSUMER_GROUP, streamId)
    .xDel(config.SECURITY_STREAM_KEY, streamId)
    .exec();
}

async function processSecurityMessage(message: StreamMessage): Promise<void> {
  let rawPayload = "";
  try {
    rawPayload = extractEventPayload(message);
    const event = JSON.parse(rawPayload) as SecurityEvent;
    const isFirstSeen = event.sourceIp
      ? await isFirstSeenSourceIp(event.sourceIp)
      : false;

    const inserted = await insertSecurityEvent(event);
    if (inserted) await evaluateSecurityAlert(event, isFirstSeen);
    await finalizeSecurityMessage(message.id);
  } catch (error) {
    const permanent = error instanceof SyntaxError;
    if (!permanent) {
      console.error("Transient security ingestion failure", {
        streamId: message.id,
        error,
      });
      return;
    }
    const attempts = await securityDeliveryCount(message.id);
    if (!shouldDeadLetter(attempts)) return;
    await storeSecurityDeadLetter({
      streamId: message.id,
      payloadHash: payloadHash(rawPayload),
      failureCode: "invalid_json",
      validationIssues: [{ path: "", message: "Invalid JSON security event" }],
      deliveryCount: attempts,
    });
    await finalizeSecurityMessage(message.id);
  }
}

async function processSecurityBatch(messages: StreamMessage[]): Promise<void> {
  for (const message of messages) await processSecurityMessage(message);
}

async function reclaimPendingSecurity(): Promise<void> {
  const reply = await securityRedis.sendCommand([
    "XAUTOCLAIM",
    config.SECURITY_STREAM_KEY,
    config.SECURITY_CONSUMER_GROUP,
    config.SECURITY_CONSUMER_NAME,
    "60000",
    "0-0",
    "COUNT",
    "50",
  ]);
  if (!Array.isArray(reply)) return;
  await processSecurityBatch(
    parseStreamReply([[config.SECURITY_STREAM_KEY, reply[1]]]),
  );
}

async function securityIngestionLoop(): Promise<void> {
  while (!stopping) {
    await reclaimPendingSecurity();
    const reply = await securityRedis.sendCommand([
      "XREADGROUP",
      "GROUP",
      config.SECURITY_CONSUMER_GROUP,
      config.SECURITY_CONSUMER_NAME,
      "COUNT",
      "50",
      "BLOCK",
      "2000",
      "STREAMS",
      config.SECURITY_STREAM_KEY,
      ">",
    ]);
    await processSecurityBatch(parseStreamReply(reply));
  }
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
      const metricsDeleted = await deleteExpiredMetricEvents(
        config.METRIC_RETENTION_DAYS,
      );
      const securityDeleted = await deleteExpiredSecurityEvents(
        config.SECURITY_RETENTION_DAYS,
      );
      console.info("Retention completed", {
        deleted,
        diagnosticsDeleted,
        alertsDeleted,
        metricsDeleted,
        securityDeleted,
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
      await checkCollectorDeadman();
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
  await metricRedis.connect();
  await securityRedis.connect();
  await ensureConsumerGroup();
  await ensureMetricConsumerGroup();
  await ensureSecurityConsumerGroup();
  await ensureMongoCollections();
  await ensureDefaultAlertRules();
  console.info("ops-worker ready");
  try {
    await Promise.all([
      ingestionLoop(),
      metricIngestionLoop(),
      securityIngestionLoop(),
      metricsLoop(),
      retentionLoop(),
      alertLoop(),
    ]);
  } finally {
    await Promise.allSettled([
      redis.isOpen ? redis.close() : Promise.resolve(),
      metricRedis.isOpen ? metricRedis.close() : Promise.resolve(),
      securityRedis.isOpen ? securityRedis.close() : Promise.resolve(),
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
