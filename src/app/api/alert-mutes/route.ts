import { ZodError } from "zod";
import { forbiddenResponse, requireAdmin } from "@/lib/server/authorization";
import {
  alertMuteInputSchema,
  removeAlertMute,
  saveAlertMute,
} from "@/lib/server/alerts/alert-store";
import { writeAuditEvent } from "@/lib/server/audit";

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  try {
    const input = alertMuteInputSchema.parse(await request.json());
    const mute = await saveAlertMute(input, admin.id);
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "alerts.mute.create",
      attributes: {
        target: input.target,
        duration: input.duration,
        reason: input.reason,
      },
    });
    return Response.json({ data: mute });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { error: "Invalid alert mute", issues: error.issues },
        { status: 400 },
      );
    console.error("Failed to mute alerts", error);
    return Response.json({ error: "Failed to mute alerts" }, { status: 500 });
  }
}
export async function DELETE(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  const target = new URL(request.url).searchParams.get("target");
  if (!target)
    return Response.json({ error: "Target is required" }, { status: 400 });
  try {
    const removed = await removeAlertMute(target);
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "alerts.mute.delete",
      attributes: { target },
    });
    return removed
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Mute not found" }, { status: 404 });
  } catch (error) {
    console.error("Failed to unmute alerts", error);
    return Response.json({ error: "Failed to unmute alerts" }, { status: 500 });
  }
}
