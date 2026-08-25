import { ZodError } from "zod";
import { parseLogsQuery } from "@/lib/server/logs/log-query";
import { listLogs } from "@/lib/server/logs/log-repository";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    const result = await listLogs(parseLogsQuery(request.url));
    return Response.json({ message: "Logs fetched successfully", ...result });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid log query", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Failed to fetch logs", error);
    return Response.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
