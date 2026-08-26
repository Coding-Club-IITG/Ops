import type { ReactNode } from "react";
import styles from "@/components/status-badge.module.scss";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function StatusBadge({
  children,
  className,
  live,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  live?: "off" | "polite" | "assertive";
  tone?: StatusTone;
}) {
  return (
    <span
      className={`${styles.badge} ${styles[tone]}${className ? ` ${className}` : ""}`}
      aria-live={live}
    >
      {children}
    </span>
  );
}
