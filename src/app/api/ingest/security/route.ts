import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getRuntimeConfig } from "@/lib/server/env";
import { getWebRedis } from "@/lib/server/redis";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 256 * 1_024; // 256 KB

const securityEventSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.enum([
      "login_success",
      "login_failure",
      "session_opened",
      "session_closed",
      "sudo_escalation",
      "collector_heartbeat",
    ]),
    occurredAt: z.string(),
    account: z.string(),
    sourceIp: z.string().optional(),
    sourcePort: z.number().optional(),
    authMethod: z.string().optional(),
    keyType: z.string().optional(),
    keyFingerprint: z.string().optional(),
    subnetClassification: z.string().optional(),
    reverseDns: z.string().optional(),
    service: z.string().optional(),
    tty: z.string().optional(),
    workingDirectory: z.string().optional(),
    command: z.string().optional(),
    targetAccount: z.string().optional(),
    actor: z.string().optional(),
    queueDepth: z.number().optional(),
    result: z.enum(["success", "failure"]),
    summary: z.string(),
    rawMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const batchIngestSchema = z
  .object({
    schemaVersion: z.literal(1),
    events: z.array(securityEventSchema).min(1).max(100),
  })
  .strict();

function authenticated(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(getRuntimeConfig().SECURITY_INGEST_SECRET);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!authenticated(request)) {
    return Response.json(
      { error: "Invalid security ingestion credentials" },
      { status: 401 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: "Request body exceeds 256 KB" },
      { status: 413 },
    );
  }

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) {
      return Response.json(
        { error: "Request body exceeds 256 KB" },
        { status: 413 },
      );
    }

    const payloadText = new TextDecoder().decode(bytes);
    const parsed = batchIngestSchema.parse(JSON.parse(payloadText));

    const redis = await getWebRedis();
    const config = getRuntimeConfig();

    const pipeline = redis.multi();
    for (const event of parsed.events) {
      pipeline.xAdd(config.SECURITY_STREAM_KEY, "*", {
        event: JSON.stringify(event),
      });
    }
    await pipeline.exec();

    return Response.json(
      {
        accepted: parsed.events.length,
        eventIds: parsed.events.map((e) => e.eventId),
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid security ingestion payload" },
        { status: 400 },
      );
    }
    console.error("Security ingestion request failed:", error);
    return Response.json({ error: "Ingestion unavailable" }, { status: 503 });
  }
}
