import { ZodError } from "zod";
import { parseMetricsRange } from "@/lib/server/logs/log-query";
import {
  getRegisteredService,
  getServiceAnalytics,
} from "@/lib/server/services/service-analytics";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ service: string }> },
): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    const registered = getRegisteredService((await params).service);
    if (!registered)
      return Response.json(
        { error: "Unknown registered service" },
        { status: 404 },
      );
    return Response.json(
      await getServiceAnalytics(
        registered.service,
        registered.project,
        parseMetricsRange(request.url),
      ),
    );
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { error: "Invalid analytics range" },
        { status: 400 },
      );
    console.error("Failed to fetch service analytics", error);
    return Response.json(
      { error: "Failed to fetch service analytics" },
      { status: 500 },
    );
  }
}
