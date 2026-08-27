import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuditView } from "@/features/audit-view";
import { auth } from "@/lib/auth";
import { resolveOperator } from "@/lib/server/authorization";

export default async function AuditPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const operator = session ? await resolveOperator(session.user) : null;
  if (!operator) redirect("/sign-in?error=access-denied");
  if (operator.role !== "admin") redirect("/");
  return <AuditView />;
}
