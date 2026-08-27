import { ZodError } from "zod";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";
import { listAlerts, parseAlertQuery } from "@/lib/server/alerts/alert-store";

export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    return Response.json({
      ...(await listAlerts(parseAlertQuery(request.url))),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { error: "Invalid alert query", issues: error.issues },
        { status: 400 },
      );
    console.error("Failed to list alerts", error);
    return Response.json({ error: "Failed to list alerts" }, { status: 500 });
  }
}
