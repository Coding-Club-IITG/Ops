import { ZodError } from "zod";
import {
  forbiddenResponse,
  requireAdmin,
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";
import {
  alertRuleInputSchema,
  deleteAlertRuleOverride,
  listAlertRules,
  saveAlertRule,
} from "@/lib/server/alerts/alert-rules";
import { writeAuditEvent } from "@/lib/server/audit";

export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    return Response.json({ data: await listAlertRules() });
  } catch (error) {
    console.error("Failed to list alert rules", error);
    return Response.json(
      { error: "Failed to list alert rules" },
      { status: 500 },
    );
  }
}
export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  try {
    const input = alertRuleInputSchema.parse(await request.json());
    const rule = await saveAlertRule(input, admin.id);
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "alerts.rule.upsert",
      attributes: {
        ruleKey: rule.ruleKey,
        target: rule.target,
        enabled: rule.enabled,
        severity: rule.severity,
      },
    });
    return Response.json({ data: rule });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        { error: "Invalid alert rule", issues: error.issues },
        { status: 400 },
      );
    console.error("Failed to save alert rule", error);
    return Response.json(
      { error: "Failed to save alert rule" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();
  const params = new URL(request.url).searchParams;
  try {
    const ruleKey = alertRuleInputSchema.shape.ruleKey.parse(
      params.get("ruleKey"),
    );
    const target = params.get("target") ?? "";
    if (!(await deleteAlertRuleOverride(ruleKey, target)))
      return Response.json(
        { error: "Service override not found" },
        { status: 404 },
      );
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "alerts.rule.delete",
      attributes: { ruleKey, target },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json({ error: "Invalid alert rule" }, { status: 400 });
    console.error("Failed to delete alert rule override", error);
    return Response.json(
      { error: "Failed to delete alert rule override" },
      { status: 500 },
    );
  }
}
