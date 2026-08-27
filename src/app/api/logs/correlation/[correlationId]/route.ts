import { z, ZodError } from "zod";
import { listCorrelationTimeline } from "@/lib/server/logs/log-repository";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

const correlationIdSchema = z.string().trim().min(1).max(128);
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ correlationId: string }> },
): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    const correlationId = correlationIdSchema.parse(
      (await params).correlationId,
    );
    const result = await listCorrelationTimeline(correlationId);
    return Response.json({ ...result, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { error: "Invalid correlation ID" },
        { status: 400 },
      );
    console.error("Failed to fetch correlation timeline", error);
    return Response.json(
      { error: "Failed to fetch correlation timeline" },
      { status: 500 },
    );
  }
}
