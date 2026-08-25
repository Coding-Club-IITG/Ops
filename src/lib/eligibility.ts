export type OperatorIdentity = {
  id: string;
  email: string;
  role: "viewer" | "admin";
};

type EligibilityInput = {
  id?: unknown;
  email?: unknown;
};

export function evaluateEligibility(
  user: EligibilityInput,
  grant: { email?: unknown; role?: unknown; enabled?: unknown } | null,
): OperatorIdentity | null {
  const userEmail =
    typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  const grantEmail =
    typeof grant?.email === "string" ? grant.email.trim().toLowerCase() : "";
  const role = grant?.role;

  if (
    typeof user.id !== "string" ||
    !userEmail ||
    !grant ||
    grant.enabled !== true ||
    userEmail !== grantEmail ||
    (role !== "viewer" && role !== "admin")
  )
    return null;

  return {
    id: user.id,
    email: userEmail,
    role,
  };
}
