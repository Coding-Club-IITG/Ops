import { ZodError } from "zod";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";
import {
  getMetricCatalog,
  metricCatalogQuerySchema,
} from "@/lib/server/metrics/project-metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const operator = await requireOperator(request);
  if (!operator) return unauthorizedResponse();
  try {
    const params = Object.fromEntries(
      new URL(request.url).searchParams.entries(),
    );
    return Response.json({
      data: await getMetricCatalog(metricCatalogQuerySchema.parse(params)),
    });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { error: "Invalid metric catalog selection" },
        { status: 400 },
      );
    console.error("Failed to load project metric catalog");
    return Response.json(
      { error: "Failed to load metric catalog" },
      { status: 500 },
    );
  }
}
