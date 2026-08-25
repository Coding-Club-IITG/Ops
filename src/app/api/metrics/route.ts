import { ZodError } from "zod";
import { parseMetricsRange } from "@/lib/server/logs/log-query";
import { getMetricSnapshots } from "@/lib/server/metrics/metrics-store";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    const range = parseMetricsRange(request.url);
    const data = await getMetricSnapshots(range);
    const lastUpdated = data.at(-1)?.measuredAt ?? null;
    return Response.json({
      data,
      range,
      lastUpdated,
      stale:
        !lastUpdated || Date.now() - new Date(lastUpdated).getTime() > 60_000,
    });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json({ error: "Invalid metrics range" }, { status: 400 });
    console.error("Failed to fetch metrics", error);
    return Response.json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
}
