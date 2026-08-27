import { forbiddenResponse, requireAdmin } from "@/lib/server/authorization";
import { sendDiscordTest } from "@/lib/server/alerts/discord";
import { getRuntimeConfig } from "@/lib/server/env";
import { writeAuditEvent } from "@/lib/server/audit";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireAdmin(request))) return forbiddenResponse();
  return Response.json({
    configured: Boolean(getRuntimeConfig().DISCORD_ALERT_WEBHOOK_URL),
  });
}
export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  try {
    await sendDiscordTest();
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "alerts.discord.test",
      attributes: { success: true },
    });
    return Response.json({ ok: true });
  } catch (error) {
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "alerts.discord.test",
      attributes: { success: false },
    }).catch(() => undefined);
    console.error("Discord alert test failed", error);
    return Response.json(
      { error: "Discord test message failed" },
      { status: 502 },
    );
  }
}
