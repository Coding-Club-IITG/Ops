import { ZodError } from "zod";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";
import {
  projectMetricQuerySchema,
  queryProjectMetrics,
} from "@/lib/server/metrics/project-metrics";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const operator = await requireOperator(request);
  if (!operator) return unauthorizedResponse();
  try {
    const query = projectMetricQuerySchema.parse(await request.json());
    return Response.json({ data: await queryProjectMetrics(query) });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return Response.json(
        { error: "Invalid project metric query" },
        { status: 400 },
      );
    console.error("Failed to query project metrics");
    return Response.json(
      { error: "Failed to query project metrics" },
      { status: 500 },
    );
  }
}
