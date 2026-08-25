"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import styles from "@/components/layout/navbar.module.scss";

const navItems = [
  { name: "Overview", href: "/" },
  { name: "Logs", href: "/logs" },
  { name: "Metrics", href: "/metrics" },
];

export function Navbar({
  operator,
}: {
  operator: { email: string; role: string };
}) {
  const pathname = usePathname();
  const items =
    operator.role === "admin"
      ? [...navItems, { name: "Users", href: "/operators" }]
      : navItems;

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          Ops
        </Link>
        <nav className={styles.nav} aria-label="Primary navigation">
          {items.map(({ name, href }) => {
            const active = pathname === href || pathname.startsWith(href + "/");

            return (
              <Link
                key={href}
                href={href}
                className={`${styles.link} ${active ? styles.active : ""}`}
              >
                {name}
              </Link>
            );
          })}
        </nav>

        <div className={styles.spacer} />
        <div className={styles.context}>
          <div className={styles.environment}>
            <Activity size={16} strokeWidth={2.5} />
            <span>Production</span>
          </div>
          <div className={styles.divider} />
          <div className={styles.operator}>
            <span>{operator.email}</span>
            <span className={styles.role}>{operator.role}</span>
          </div>
          <div className={styles.divider} />
          <button
            className={styles.signOut}
            onClick={() =>
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => window.location.assign("/sign-in"),
                },
              })
            }
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
