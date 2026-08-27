import { ZodError } from "zod";
import { listAuditEvents, parseAuditQuery } from "@/lib/server/audit";
import { forbiddenResponse, requireAdmin } from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireAdmin(request))) return forbiddenResponse();
  try {
    const result = await listAuditEvents(parseAuditQuery(request.url));
    return Response.json({ ...result, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { error: "Invalid audit query", issues: error.issues },
        { status: 400 },
      );
    console.error("Failed to fetch audit events", error);
    return Response.json(
      { error: "Failed to fetch audit events" },
      { status: 500 },
    );
  }
}
