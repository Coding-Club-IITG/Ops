import { ZodError } from "zod";
import { parseMetricsRange } from "@/lib/server/logs/log-query";
import { getMetricSnapshots } from "@/lib/server/metrics/metrics-store";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";
import { metricSnapshotForRole } from "@/lib/server/metrics/metrics-visibility";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const operator = await requireOperator(request);
  if (!operator) return unauthorizedResponse();
  try {
    const range = parseMetricsRange(request.url);
    const snapshots = await getMetricSnapshots(range);
    const data = snapshots.map((snapshot) =>
      metricSnapshotForRole(snapshot, operator.role),
    );
    const lastUpdated = data.at(-1)?.measuredAt ?? null;
    return Response.json({
      data,
      range,
      operatorRole: operator.role,
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
