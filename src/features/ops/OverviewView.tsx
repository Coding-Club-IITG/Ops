"use client";

import { useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { OverviewData } from "@/types/ops.types";
import { usePolling } from "@/features/ops/use-polling";
import styles from "@/features/ops/ops.module.scss";
import { LOG_EVENT_PROJECT_REGISTRY } from "@contracts/log-event-v1/project-registry";

const PROJECT_NAMES = new Map(
  LOG_EVENT_PROJECT_REGISTRY.map((project) => [project.id, project.name]),
);

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}
function formatBytes(value: number): string {
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function OverviewView() {
  const load = useCallback(
    async () => ((await apiFetch("/overview")) as { data: OverviewData }).data,
    [],
  );
  const { data, loading, error } = usePolling(load);

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Production observability</p>
          <h1 className={styles.heading}>Operations overview</h1>
          <p className={styles.subheading}>
            A safe, current view of registered services, host capacity, and
            production event health.
          </p>
        </div>
        <span
          className={`${styles.status} ${data?.metricsStale ? styles.stale : styles.healthy}`}
        >
          {data?.metricsStale ? "Metrics stale" : "Metrics current"}
        </span>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.grid} aria-busy={loading}>
        <article className={styles.stat}>
          <span className={styles.statLabel}>Events · 24h</span>
          <strong className={styles.statValue}>
            {data ? formatNumber(data.logsLast24Hours) : "-"}
          </strong>
        </article>
        <article className={styles.stat}>
          <span className={styles.statLabel}>Errors · 24h</span>
          <strong className={styles.statValue}>
            {data ? formatNumber(data.errorsLast24Hours) : "-"}
          </strong>
        </article>
        <article className={styles.stat}>
          <span className={styles.statLabel}>Error rate</span>
          <strong className={styles.statValue}>
            {data ? `${(data.errorRate * 100).toFixed(2)}%` : "-"}
          </strong>
        </article>
        <article className={styles.stat}>
          <span className={styles.statLabel}>CPU usage</span>
          <strong className={styles.statValue}>
            {data?.metrics
              ? `${data.metrics.cpu.usagePercent.toFixed(1)}%`
              : "-"}
          </strong>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Registered services</h2>
            <span className={styles.muted}>
              {data?.services.length ?? 0} services
            </span>
          </div>
          <div className={`${styles.panelBody} ${styles.serviceList}`}>
            {data?.services.map((service) => (
              <div className={styles.serviceRow} key={service.service}>
                <div>
                  <strong>{service.service}</strong>
                  <div className={styles.muted}>
                    {PROJECT_NAMES.get(service.project) ?? service.project}
                  </div>
                </div>
                <span className={`${styles.status} ${styles[service.status]}`}>
                  {service.status}
                </span>
                <span className={styles.muted}>
                  {service.errorsLastHour} errors / hour
                </span>
              </div>
            )) ?? (
              <div className={styles.empty}>Waiting for service events…</div>
            )}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Host capacity</h2>
            <span className={styles.muted}>30 second samples</span>
          </div>
          <div className={`${styles.panelBody} ${styles.serviceList}`}>
            <Metric
              label="CPU"
              value={
                data?.metrics
                  ? `${data.metrics.cpu.usagePercent.toFixed(1)}%`
                  : "-"
              }
              percent={data?.metrics?.cpu.usagePercent}
            />
            <Metric
              label="Memory"
              value={
                data?.metrics
                  ? `${formatBytes(data.metrics.memory.usedBytes)} / ${formatBytes(data.metrics.memory.totalBytes)}`
                  : "-"
              }
              percent={
                data?.metrics
                  ? (data.metrics.memory.usedBytes /
                      data.metrics.memory.totalBytes) *
                    100
                  : undefined
              }
            />
            <Metric
              label="Network receive"
              value={
                data?.metrics
                  ? `${(data.metrics.network.rxBytesPerSecond / 1024).toFixed(1)} KB/s`
                  : "-"
              }
            />
            <Metric
              label="Active connections"
              value={
                data?.metrics
                  ? formatNumber(data.metrics.network.activeConnections)
                  : "-"
              }
            />
          </div>
        </article>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent?: number;
}) {
  return (
    <div>
      <div className={styles.serviceRow}>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      {percent !== undefined && (
        <meter
          className={styles.meter}
          aria-label={`${label} ${percent.toFixed(1)} percent`}
          min={0}
          max={100}
          value={Math.min(100, percent)}
        />
      )}
    </div>
  );
}
