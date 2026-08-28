"use client";

import { useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import type { OverviewData } from "@/types/ops.types";
import { usePolling } from "@/features/use-polling";
import { StatCard } from "@/features/stat-card";
import { SERVICE_STATUS_TONES } from "@/features/status-tones";
import {
  formatBytes,
  formatDuration,
  formatIndianNumber,
} from "@/lib/formatters";
import styles from "@/features/ops.module.scss";
import { LOG_EVENT_PROJECT_REGISTRY } from "@contract/project-registry";

const PROJECT_NAMES = new Map(
  LOG_EVENT_PROJECT_REGISTRY.map((project) => [project.id, project.name]),
);

export function OverviewView() {
  const load = useCallback(
    async () => ((await apiFetch("/overview")) as { data: OverviewData }).data,
    [],
  );
  const { data, loading, error } = usePolling(load);
  const metricsStatus = !data
    ? {
        label: loading ? "Loading metrics" : "Metrics unavailable",
        tone: "neutral" as const,
      }
    : data.metricsStale
      ? { label: "Metrics stale", tone: "warning" as const }
      : { label: "Metrics current", tone: "success" as const };

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Production observability</p>
          <h1 className={styles.heading}>Operations overview</h1>
          <p className={styles.subheading}>
            Current view of registered services, host capacity, and production
            event health.
          </p>
        </div>
        <div className={styles.headerActions}>
          <StatusBadge tone={metricsStatus.tone}>
            {metricsStatus.label}
          </StatusBadge>
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.grid} aria-busy={loading}>
        <div className={`${styles.statGrid} ${styles.overviewStatGrid}`}>
          <StatCard
            label="Events · 24h"
            value={data ? formatIndianNumber(data.logsLast24Hours) : "-"}
          />
          <StatCard
            label="Host uptime"
            value={
              data?.metrics ? formatDuration(data.metrics.uptimeSeconds) : "-"
            }
          />
          <StatCard
            label="Host health"
            value={data?.health.status ?? "-"}
            detail={data?.health.reasons.join(" · ") || undefined}
          />
          <StatCard
            label="Errors · 24h"
            value={data ? formatIndianNumber(data.errorsLast24Hours) : "-"}
          />
          <StatCard
            label="Error rate"
            value={data ? `${(data.errorRate * 100).toFixed(2)}%` : "-"}
          />
          <StatCard
            label="CPU usage"
            value={
              data?.metrics
                ? `${data.metrics.cpu.usagePercent.toFixed(1)}%`
                : "-"
            }
          />
        </div>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Registered services</h2>
            <span className={styles.muted}>
              {data?.services.length ?? 0} services
            </span>
          </div>
          <div className={`${styles.panelBody} ${styles.serviceList}`}>
            {data?.services.length ? (
              data.services.map((service) => (
                <div className={styles.serviceRow} key={service.service}>
                  <div>
                    <strong>{service.service}</strong>
                    <div className={styles.muted}>
                      {PROJECT_NAMES.get(service.project) ?? service.project}
                    </div>
                  </div>
                  <StatusBadge tone={SERVICE_STATUS_TONES[service.status]}>
                    {service.status}
                  </StatusBadge>
                  <span className={styles.muted}>
                    {service.errorsLastHour} errors / hour
                  </span>
                </div>
              ))
            ) : (
              <div className={styles.empty}>Waiting for service events…</div>
            )}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Host capacity</h2>
            <span className={styles.muted}>30 second samples</span>
          </div>
          <div className={`${styles.panelBody} ${styles.metricList}`}>
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
                  ? `${formatBytes(data.metrics.network.rxBytesPerSecond)}/s`
                  : "-"
              }
            />
            <Metric
              label="Active connections"
              value={
                data?.metrics
                  ? formatIndianNumber(data.metrics.network.activeConnections)
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
    <div className={styles.metricRow}>
      <div className={styles.metricSummary}>
        <strong>{label}</strong>
        <span className={styles.metricValue}>{value}</span>
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
