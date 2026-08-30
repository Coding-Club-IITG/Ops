import type { ReactNode } from "react";
import { formatIndianNumber } from "@/lib/formatters";
import styles from "@/features/ops.module.scss";

export function Pagination({
  total,
  noun,
  page,
  pages,
  onPrevious,
  onNext,
  children,
}: {
  total: number;
  noun: string;
  page: number;
  pages: number;
  onPrevious: () => void;
  onNext: () => void;
  children?: ReactNode;
}) {
  return (
    <nav className={styles.pagination} aria-label={`${noun} pagination`}>
      <span className={styles.muted}>
        {formatIndianNumber(total)} {noun} · page {page} of {pages}
      </span>
      <button
        className={styles.secondaryButton}
        disabled={page <= 1}
        onClick={onPrevious}
      >
        Previous
      </button>
      <button
        className={styles.secondaryButton}
        disabled={page >= pages}
        onClick={onNext}
      >
        Next
      </button>
      {children}
    </nav>
  );
}
