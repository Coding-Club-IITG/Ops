import { getServiceSummaries } from "@/lib/server/logs/log-repository";
import { getLatestMetricSnapshot } from "@/lib/server/metrics/metrics-store";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    const [services, metrics] = await Promise.all([
      getServiceSummaries(),
      getLatestMetricSnapshot(),
    ]);
    return Response.json({
      data: services,
      processes: metrics?.pm2 ?? [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch services", error);
    return Response.json(
      { error: "Failed to fetch services" },
      { status: 500 },
    );
  }
}
