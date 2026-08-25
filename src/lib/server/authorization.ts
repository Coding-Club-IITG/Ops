import "server-only";

import { auth } from "@/lib/auth";
import { evaluateEligibility, type OperatorIdentity } from "@/lib/eligibility";
import { findEnabledOperatorGrant } from "@/lib/server/operator-grants";

export { evaluateEligibility } from "@/lib/eligibility";

export async function resolveOperator(
  user: Parameters<typeof evaluateEligibility>[0],
): Promise<OperatorIdentity | null> {
  if (typeof user.email !== "string") return null;

  try {
    const grant = await findEnabledOperatorGrant(user.email);
    return evaluateEligibility(user, grant);
  } catch (error) {
    console.error("Ops operator grant lookup failed", error);
    return null;
  }
}

export async function requireOperator(
  request: Request,
): Promise<OperatorIdentity | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session ? await resolveOperator(session.user) : null;
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: "Operator authentication required" },
    { status: 401 },
  );
}

export async function requireAdmin(
  request: Request,
): Promise<OperatorIdentity | null> {
  const operator = await requireOperator(request);
  return operator?.role === "admin" ? operator : null;
}

export function forbiddenResponse(): Response {
  return Response.json({ error: "Ops admin access required" }, { status: 403 });
}
