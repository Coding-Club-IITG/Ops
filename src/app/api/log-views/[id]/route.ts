import { ZodError } from "zod";
import {
  deleteLogView,
  isDuplicateLogViewError,
  logViewPatchSchema,
  updateLogView,
} from "@/lib/server/log-views";
import { forbiddenResponse, requireAdmin } from "@/lib/server/authorization";
import { writeAuditEvent } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  const { id } = await context.params;
  try {
    const view = await updateLogView(
      id,
      logViewPatchSchema.parse(await request.json()),
      admin.id,
    );
    if (!view)
      return Response.json({ error: "Log view not found" }, { status: 404 });
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "log_views.update",
      attributes: { viewId: view.id, name: view.name },
    });
    return Response.json({ data: view });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { error: "Invalid log view", issues: error.issues },
        { status: 400 },
      );
    if (isDuplicateLogViewError(error))
      return Response.json(
        { error: "A log view with that name exists" },
        { status: 409 },
      );
    console.error("Failed to update log view", error);
    return Response.json(
      { error: "Failed to update log view" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  const { id } = await context.params;
  try {
    if (!(await deleteLogView(id)))
      return Response.json({ error: "Log view not found" }, { status: 404 });
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "log_views.delete",
      attributes: { viewId: id },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete log view", error);
    return Response.json(
      { error: "Failed to delete log view" },
      { status: 500 },
    );
  }
}
