import { ZodError } from "zod";
import { getLogVolume } from "@/lib/server/logs/log-repository";
import { parseLogsQuery } from "@/lib/server/logs/log-query";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    const volume = await getLogVolume(parseLogsQuery(request.url));
    return Response.json({
      ...volume,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid log volume query", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Failed to fetch log volume", error);
    return Response.json(
      { error: "Failed to fetch log volume" },
      { status: 500 },
    );
  }
}
