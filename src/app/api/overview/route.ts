import {
  getLogVolume,
  getServiceSummaries,
} from "@/lib/server/logs/log-repository";
import { getLatestMetricSnapshot } from "@/lib/server/metrics/metrics-store";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    const [volume, services, metrics] = await Promise.all([
      getLogVolume(24),
      getServiceSummaries(),
      getLatestMetricSnapshot(),
    ]);
    const total = volume.reduce((sum, point) => sum + point.count, 0);
    const errors = volume
      .filter((point) => point.level === "error" || point.level === "fatal")
      .reduce((sum, point) => sum + point.count, 0);
    const lastUpdated = metrics?.measuredAt ?? null;
    return Response.json({
      data: {
        logsLast24Hours: total,
        errorsLast24Hours: errors,
        errorRate: total ? errors / total : 0,
        services,
        metrics,
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
