import {
  getLogVolume,
  getServiceSummaries,
} from "@/lib/server/logs/log-repository";
import { getLatestMetricSnapshot } from "@/lib/server/metrics/metrics-store";
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
    const [volume, services, metrics] = await Promise.all([
      getLogVolume({ limit: 50, offset: 0, sort: "timestamp", order: "desc" }),
      getServiceSummaries(),
      getLatestMetricSnapshot(),
    ]);
    const total = volume.buckets.reduce((sum, point) => sum + point.total, 0);
    const errors = volume.buckets.reduce(
      (sum, point) => sum + point.error + point.fatal,
      0,
    );
    const lastUpdated = metrics?.measuredAt ?? null;
    return Response.json({
      data: {
        logsLast24Hours: total,
        errorsLast24Hours: errors,
        errorRate: total ? errors / total : 0,
        services,
        metrics: metrics ? metricSnapshotForRole(metrics, operator.role) : null,
        metricsStale:
          !lastUpdated || Date.now() - new Date(lastUpdated).getTime() > 60_000,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch overview", error);
    return Response.json(
      { error: "Failed to fetch overview" },
      { status: 500 },
    );
  }
}
