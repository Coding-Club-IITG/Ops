"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import type { MetricSnapshot } from "@/types/ops.types";
import { usePolling } from "@/features/ops/use-polling";
import styles from "@/features/ops/ops.module.scss";

type Range = "1h" | "6h" | "24h" | "7d" | "30d";

function processStatusTone(status: string): StatusTone {
  if (status === "online") return "success";
  if (status === "errored") return "danger";
  if (status === "stopped" || status === "stopping") return "warning";
  return "neutral";
}

export function MetricsView() {
  const [range, setRange] = useState<Range>("1h");
  const load = useCallback(
    async () =>
      apiFetch("/metrics", {}, { range }) as Promise<{
        data: MetricSnapshot[];
        stale: boolean;
        lastUpdated: string | null;
      }>,
    [range],
  );
  const { data, loading, error } = usePolling(load);
  const latest = data?.data.at(-1) ?? null;
  const sampleStatus = !data
    ? { label: loading ? "Loading" : "Unavailable", tone: "neutral" as const }
    : data.stale
      ? { label: "Stale", tone: "warning" as const }
      : { label: "Current", tone: "success" as const };

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Atlas time-series</p>
          <h1 className={styles.heading}>Host metrics</h1>
          <p className={styles.subheading}>
            Read-only host and registered PM2 process telemetry, sampled every
            30 seconds.
          </p>
        </div>
        <div className={styles.headerActions}>
          <select
            className={`${styles.select} ${styles.compactSelect}`}
            aria-label="Metrics range"
            value={range}
            onChange={(event) => setRange(event.target.value as Range)}
          >
            {["1h", "6h", "24h", "7d", "30d"].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.grid} aria-busy={loading}>
        <MetricStat
          label="CPU"
          value={latest ? `${latest.cpu.usagePercent.toFixed(1)}%` : "-"}
        />
        <MetricStat
          label="Memory"
          value={
            latest
              ? `${((latest.memory.usedBytes / latest.memory.totalBytes) * 100).toFixed(1)}%`
              : "-"
          }
        />
        <MetricStat
          label="Disk read"
          value={latest ? `${latest.disk.readsPerSecond.toFixed(1)} op/s` : "-"}
        />
        <MetricStat
          label="Connections"
          value={latest ? String(latest.network.activeConnections) : "-"}
        />
        <article className={`${styles.panel} ${styles.panelWide}`}>
          <div className={styles.panelHeader}>
            <h2>Registered PM2 processes</h2>
            <StatusBadge tone={sampleStatus.tone}>
              {sampleStatus.label}
            </StatusBadge>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Process</th>
                  <th>Status</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>Restarts</th>
                  <th>Uptime</th>
                </tr>
              </thead>
              <tbody>
                {latest?.pm2.map((process) => (
                  <tr key={process.name}>
                    <td>
                      <strong>{process.name}</strong>
                    </td>
                    <td>
                      <StatusBadge tone={processStatusTone(process.status)}>
                        {process.status}
                      </StatusBadge>
                    </td>
                    <td>{process.cpuPercent.toFixed(1)}%</td>
                    <td>{process.memoryMb} MB</td>
                    <td>{process.restartCount}</td>
                    <td>{formatDuration(process.uptimeSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!latest?.pm2.length && (
              <div className={styles.empty}>
                No registered PM2 processes reported.
              </div>
            )}
          </div>
        </article>
        <article className={`${styles.panel} ${styles.panelWide}`}>
          <div className={styles.panelHeader}>
            <h2>CPU history</h2>
            <span className={styles.muted}>
              {data?.data.length ?? 0} samples
            </span>
          </div>
          <div className={styles.panelBody}>
            {data?.data.length ? (
              <div
                className={styles.historyChart}
                aria-label="CPU usage history"
              >
                {data.data.map((point) => (
                  <meter
                    className={styles.historyBar}
                    key={point.measuredAt}
                    title={`${new Date(point.measuredAt).toLocaleString()}: ${point.cpu.usagePercent.toFixed(1)}%`}
                    min={0}
                    max={100}
                    value={point.cpu.usagePercent}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.empty}>No metric samples reported.</div>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <article className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
    </article>
  );
}
function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}
