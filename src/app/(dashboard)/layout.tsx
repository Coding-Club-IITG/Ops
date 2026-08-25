import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import { auth } from "@/lib/auth";
import { resolveOperator } from "@/lib/server/authorization";
import styles from "@/app/(dashboard)/dashboard-layout.module.scss";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  const operator = session ? await resolveOperator(session.user) : null;
  if (!operator) redirect("/sign-in?error=access-denied");

  return (
    <div className={styles.shell}>
      <Navbar operator={{ email: operator.email, role: operator.role }} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
