"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { authClient } from "@/lib/auth-client";
import styles from "@/components/layout/navbar.module.scss";

const navItems = [
  { name: "Overview", shortName: "Home", href: "/" },
  { name: "Infra", shortName: "Infra", href: "/infrastructure" },
  { name: "Services", shortName: "Svc", href: "/services" },
  { name: "Logs", shortName: "Logs", href: "/logs" },
  { name: "Analytics", shortName: "Data", href: "/analytics" },
  { name: "Alerts", shortName: "Alerts", href: "/alerts" },
];

export function Navbar({
  operator,
}: {
  operator: { email: string; role: string };
}) {
  const pathname = usePathname();
  const items =
    operator.role === "admin"
      ? [
          ...navItems,
          { name: "Audit", href: "/audit" },
          { name: "Users", href: "/operators" },
        ]
      : navItems;

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <span>CC IITG</span>
          <span className={styles.brandSeparator}>/</span>
          <strong>Ops</strong>
        </Link>
        <ThemeToggle />
        <nav className={styles.nav} aria-label="Primary navigation">
          {items.map(({ name, href, ...item }) => {
            const active = pathname === href || pathname.startsWith(href + "/");

            return (
              <Link
                key={href}
                href={href}
                className={`${styles.link} ${active ? styles.active : ""}`}
              >
                <span className={styles.longLabel}>{name}</span>
                <span className={styles.shortLabel}>
                  {"shortName" in item ? item.shortName : name}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.spacer} />
        <div className={styles.context}>
          <StatusBadge className={styles.environment} tone="success">
            <span>production</span>
          </StatusBadge>
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
