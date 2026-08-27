import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AlertsView } from "@/features/alerts-view";
import { auth } from "@/lib/auth";
import { resolveOperator } from "@/lib/server/authorization";

export default async function AlertsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const operator = session ? await resolveOperator(session.user) : null;
  if (!operator) redirect("/sign-in?error=access-denied");
  return <AlertsView admin={operator.role === "admin"} />;
}
