import { timingSafeEqual } from "node:crypto";
import { parseLogEventV1 } from "@contracts/log-event-v1/log-event-v1";
import { z } from "zod";
import { getRuntimeConfig } from "@/lib/server/env";
import {
  sanitizeDiagnostic,
  sanitizeText,
} from "@/lib/server/logs/log-diagnostics";
import { INGESTION_ENVELOPE_VERSION } from "@/lib/server/logs/ingestion-envelope";
import { getWebRedis } from "@/lib/server/redis";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 64 * 1_024;

const errorSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z
    .object({
      name: z.string().optional(),
      code: z.union([z.string(), z.number()]).optional(),
      message: z.string().optional(),
      stack: z.string().optional(),
      cause: errorSchema.optional(),
    })
    .strict(),
);

const ingestionSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string(),
    timestamp: z.string(),
    project: z.string(),
    service: z.string(),
    environment: z.literal("production"),
    kind: z.enum(["application", "http"]),
    level: z.enum(["debug", "info", "warn", "error", "fatal"]),
    message: z.string(),
    correlationId: z.string().optional(),
    http: z
      .object({
        method: z.string(),
        route: z.string(),
        statusCode: z.number(),
        durationMs: z.number(),
        requestBytes: z.number().optional(),
        responseBytes: z.number().optional(),
      })
      .strict()
      .optional(),
    error: errorSchema.optional(),
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();

function authenticated(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(getRuntimeConfig().LOG_INGEST_SECRET);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!authenticated(request))
    return Response.json(
      { error: "Invalid ingestion credentials" },
      { status: 401 },
    );

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES)
    return Response.json(
      { error: "Request body exceeds 64 KB" },
      { status: 413 },
    );

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES)
      return Response.json(
        { error: "Request body exceeds 64 KB" },
        { status: 413 },
      );
    const input = ingestionSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const safeMessage = sanitizeText(input.message);
    const diagnostic = sanitizeDiagnostic(input.error);
    const error = input.error
      ? {
          ...(typeof input.error.name === "string"
            ? {
                name: sanitizeText(input.error.name, "Error").value.slice(
                  0,
                  128,
                ),
              }
            : {}),
          ...(typeof input.error.code === "string" ||
          typeof input.error.code === "number"
            ? {
                code: sanitizeText(
                  String(input.error.code),
                  "unknown",
                ).value.slice(0, 128),
              }
            : {}),
        }
      : undefined;
    const event = parseLogEventV1({
      ...input,
      message: safeMessage.value,
      ...(error ? { error } : {}),
    });
    const envelope = {
      envelopeVersion: INGESTION_ENVELOPE_VERSION,
      event,
      ...(diagnostic ? { diagnostic } : {}),
    };
    const redis = await getWebRedis();
    await redis.xAdd(getRuntimeConfig().LOG_STREAM_KEY, "*", {
      event: JSON.stringify(envelope),
    });
    return Response.json(
      { accepted: true, eventId: event.eventId },
      { status: 202 },
    );
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      error instanceof z.ZodError ||
      error instanceof TypeError
    )
      return Response.json(
        { error: "Invalid ingestion payload" },
        { status: 400 },
      );
    console.error("Log ingestion request failed");
    return Response.json({ error: "Ingestion unavailable" }, { status: 503 });
  }
}
