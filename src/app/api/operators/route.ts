import { ZodError } from "zod";
import { forbiddenResponse, requireAdmin } from "@/lib/server/authorization";
import { writeAuditEvent } from "@/lib/server/audit";
import {
  listOperatorGrants,
  operatorGrantInputSchema,
  upsertOperatorGrant,
} from "@/lib/server/operator-grants";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireAdmin(request))) return forbiddenResponse();

  try {
    return Response.json({ data: await listOperatorGrants() });
  } catch (error) {
    console.error("Failed to list Ops users", error);
    return Response.json(
      { error: "Failed to list Ops users" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (!admin) return forbiddenResponse();

  try {
    const input = operatorGrantInputSchema.parse(await request.json());
    if (
      input.email === admin.email &&
      (!input.enabled || input.role !== "admin")
    ) {
      return Response.json(
        { error: "You cannot remove your own admin access" },
        { status: 400 },
      );
    }

    const grant = await upsertOperatorGrant(input, admin.id);
    await writeAuditEvent({
      operatorId: admin.id,
      operatorEmail: admin.email,
      action: "operators.upsert",
      attributes: {
        targetEmail: grant.email,
        role: grant.role,
        enabled: grant.enabled,
      },
    });
    return Response.json({ data: grant }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid Ops user", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Failed to save Ops user", error);
    return Response.json({ error: "Failed to save Ops user" }, { status: 500 });
  }
}
