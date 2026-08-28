import { ProjectMetricsExplorer } from "@/features/project-metrics-explorer";
import styles from "@/features/ops.module.scss";

export function AnalyticsView() {
  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>MetricEventV1</p>
          <h1 className={styles.heading}>Analytics</h1>
          <p className={styles.subheading}>
            Explore project metrics using dimensions discovered from incoming
            events.
          </p>
        </div>
      </div>
      <ProjectMetricsExplorer />
    </main>
  );
}
