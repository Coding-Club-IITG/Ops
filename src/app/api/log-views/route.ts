import { ZodError } from "zod";
import {
  createLogView,
  isDuplicateLogViewError,
  listLogViews,
  logViewInputSchema,
} from "@/lib/server/log-views";
import {
  forbiddenResponse,
  requireAdmin,
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";
import { writeAuditEvent } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    return Response.json({ data: await listLogViews() });
  } catch (error) {
    console.error("Failed to list log views", error);
    return Response.json(
      { error: "Failed to list log views" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  try {
    const view = await createLogView(
      logViewInputSchema.parse(await request.json()),
      admin.id,
    );
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "log_views.create",
      attributes: { viewId: view.id, name: view.name },
    });
    return Response.json({ data: view }, { status: 201 });
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
    console.error("Failed to create log view", error);
    return Response.json(
      { error: "Failed to create log view" },
      { status: 500 },
    );
  }
}
