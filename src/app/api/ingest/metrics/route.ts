import { timingSafeEqual } from "node:crypto";
import {
  MetricEventV1ValidationError,
  parseMetricEventV1,
} from "@contract/metric-event-v1";
import { getRuntimeConfig } from "@/lib/server/env";
import { getWebRedis } from "@/lib/server/redis";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 32 * 1_024;

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
      { error: "Request body exceeds 32 KB" },
      { status: 413 },
    );

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES)
      return Response.json(
        { error: "Request body exceeds 32 KB" },
        { status: 413 },
      );
    const event = parseMetricEventV1(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const redis = await getWebRedis();
    await redis.xAdd(getRuntimeConfig().METRIC_STREAM_KEY, "*", {
      event: JSON.stringify(event),
    });
    return Response.json(
      { accepted: true, eventId: event.eventId },
      { status: 202 },
    );
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      error instanceof MetricEventV1ValidationError
    )
      return Response.json(
        { error: "Invalid metric payload" },
        { status: 400 },
      );
    console.error("Metric ingestion request failed");
    return Response.json({ error: "Ingestion unavailable" }, { status: 503 });
  }
}
