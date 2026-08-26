import { forbiddenResponse, requireAdmin } from "@/lib/server/authorization";
import { writeAuditEvent } from "@/lib/server/audit";
import { getLogDiagnostic } from "@/lib/server/logs/log-repository";

export const dynamic = "force-dynamic";
const OPAQUE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  const { eventId } = await context.params;
  if (!OPAQUE_EVENT_ID.test(eventId))
    return Response.json({ error: "Diagnostic not found" }, { status: 404 });
  try {
    const diagnostic = await getLogDiagnostic(eventId);
    if (!diagnostic)
      return Response.json({ error: "Diagnostic not found" }, { status: 404 });
    const { service, ...data } = diagnostic;
    await writeAuditEvent({
      operatorId: admin.id,
      action: "logs.diagnostics.view",
      attributes: { eventId, service },
    });
    return Response.json({ data });
  } catch {
    console.error("Failed to fetch log diagnostic");
    return Response.json(
      { error: "Failed to fetch diagnostic" },
      { status: 500 },
    );
  }
}
