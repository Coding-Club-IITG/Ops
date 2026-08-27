import styles from "@/features/ops.module.scss";

export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {detail && <span className={styles.statDetail}>{detail}</span>}
    </article>
  );
}
