"use client";

import { useCallback, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import type {
  HostHealth,
  MetricSnapshot,
  OsProcessMetric,
} from "@/types/ops.types";
import { usePolling } from "@/features/use-polling";
import { RangeSelect } from "@/features/range-select";
import { StatCard } from "@/features/stat-card";
import { TimeSeriesPanel } from "@/features/time-series-panel";
import { HOST_HEALTH_TONES, processStatusTone } from "@/features/status-tones";
import {
  formatBytes,
  formatCompactBytes,
  formatDuration,
  formatMilliseconds,
  formatPercent,
} from "@/lib/formatters";
import {
  CHART_COLORS,
  DEFAULT_METRICS_RANGE,
  type OpsRange,
} from "@/lib/ops-constants";
import styles from "@/features/ops.module.scss";

type ChartValueKind = "percent" | "operations" | "bytes";

export function InfrastructureView() {
  const [range, setRange] = useState<OpsRange>(DEFAULT_METRICS_RANGE);
  const load = useCallback(
    async () =>
      apiFetch("/metrics", {}, { range }) as Promise<{
        data: MetricSnapshot[];
        stale: boolean;
        lastUpdated: string | null;
        operatorRole: "viewer" | "admin";
        health: HostHealth;
      }>,
    [range],
  );
  const { data, loading, error } = usePolling(load);
  const latest = data?.data.at(-1) ?? null;
  const isAdmin = data?.operatorRole === "admin";
  const cpuStats = useMemo(() => {
    const values = data?.data.map((sample) => sample.cpu.usagePercent) ?? [];
    return {
      average: values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0,
      minimum: values.length ? Math.min(...values) : 0,
      maximum: values.length ? Math.max(...values) : 0,
    };
  }, [data]);
  const chartData = useMemo(
    () =>
      (data?.data ?? []).map((sample) => ({
        timestamp: sample.measuredAt,
        cpu: sample.cpu.usagePercent,
        memory: sample.memory.totalBytes
          ? (sample.memory.usedBytes / sample.memory.totalBytes) * 100
          : 0,
        diskRead: sample.disk.readsPerSecond,
        diskWrite: sample.disk.writesPerSecond,
        networkRx: sample.network.rxBytesPerSecond,
        networkTx: sample.network.txBytesPerSecond,
      })),
    [data],
  );
  const sampleStatus = !data
    ? { label: loading ? "Loading" : "Unavailable", tone: "neutral" as const }
    : data.stale
      ? { label: "Stale", tone: "warning" as const }
      : { label: "Current", tone: "success" as const };
  const healthTone = HOST_HEALTH_TONES[data?.health.status ?? "Unknown"];

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Host telemetry</p>
          <h1 className={styles.heading}>Infrastructure</h1>
          <p className={styles.subheading}>
            Host, PM2, disk, and network telemetry, with detailed OS
            measurements for admins.
          </p>
        </div>
        <div className={styles.headerActions}>
          {data && (
            <StatusBadge tone={healthTone}>
              {data.health.status} health
            </StatusBadge>
          )}
          <StatusBadge tone={sampleStatus.tone}>
            {sampleStatus.label}
          </StatusBadge>
          <RangeSelect
            label="Metrics range"
            value={range}
            onChange={setRange}
          />
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.grid} aria-busy={loading}>
        <div className={`${styles.statGrid} ${styles.metricsStatGrid}`}>
          <StatCard
            label="Host uptime"
            value={latest ? formatDuration(latest.uptimeSeconds) : "-"}
            detail={
              data?.health.reasons.join(" · ") ||
              "All measured resources are below thresholds"
            }
          />
          <StatCard
            label="CPU current"
            value={latest ? formatPercent(latest.cpu.usagePercent) : "-"}
            detail={
              latest
                ? `Avg ${formatPercent(cpuStats.average)} · min ${formatPercent(cpuStats.minimum)} · max ${formatPercent(cpuStats.maximum)}`
                : undefined
            }
          />
          <StatCard
            label="Memory pressure"
            value={
              latest
                ? formatPercent(
                    latest.memory.pressurePercent ??
                      (latest.memory.totalBytes
                        ? (latest.memory.usedBytes / latest.memory.totalBytes) *
                          100
                        : 0),
                  )
                : "-"
            }
            detail={
              latest
                ? `${formatBytes(latest.memory.usedBytes)} used · ${formatBytes(latest.memory.freeBytes ?? Math.max(0, latest.memory.totalBytes - latest.memory.usedBytes))} free`
                : undefined
            }
          />
          <StatCard
            label="Disk operations"
            value={
              latest
                ? `${latest.disk.readsPerSecond.toFixed(1)} / ${latest.disk.writesPerSecond.toFixed(1)}`
                : "-"
            }
            detail="read / write operations per second"
          />
          <StatCard
            label="Network"
            value={
              latest ? `${formatBytes(latest.network.rxBytesPerSecond)}/s` : "-"
            }
            detail={
              latest
                ? `RX · TX ${formatBytes(latest.network.txBytesPerSecond)}/s · ${latest.network.activeConnections} connections`
                : undefined
            }
          />
        </div>

        <TimeSeriesPanel
          title="CPU history"
          meta={`${chartData.length} samples`}
          summary={
            latest
              ? `Current ${formatPercent(latest.cpu.usagePercent)}; average ${formatPercent(cpuStats.average)}; minimum ${formatPercent(cpuStats.minimum)}; maximum ${formatPercent(cpuStats.maximum)}.`
              : "No CPU samples."
          }
          data={chartData}
          lines={[{ key: "cpu", name: "CPU %", color: CHART_COLORS.blue }]}
          formatValue={(value) => formatChartValue(Number(value), "percent")}
          formatYAxis={(value) => formatChartValue(value, "percent", true)}
          showLegend
        />
        <TimeSeriesPanel
          title="Memory history"
          meta={`${chartData.length} samples`}
          summary={
            latest
              ? `${formatBytes(latest.memory.usedBytes)} used of ${formatBytes(latest.memory.totalBytes)}.`
              : "No memory samples."
          }
          data={chartData}
          lines={[
            { key: "memory", name: "Used %", color: CHART_COLORS.purple },
          ]}
          formatValue={(value) => formatChartValue(Number(value), "percent")}
          formatYAxis={(value) => formatChartValue(value, "percent", true)}
          showLegend
        />
        <TimeSeriesPanel
          title="Disk operations history"
          meta={`${chartData.length} samples`}
          summary={
            latest
              ? `${latest.disk.readsPerSecond.toFixed(1)} read and ${latest.disk.writesPerSecond.toFixed(1)} write operations per second; ${diskWaitSummary(latest.disk)}.`
              : "No disk samples."
          }
          data={chartData}
          lines={[
            { key: "diskRead", name: "Read op/s", color: CHART_COLORS.green },
            {
              key: "diskWrite",
              name: "Write op/s",
              color: CHART_COLORS.yellow,
            },
          ]}
          formatValue={(value) => formatChartValue(Number(value), "operations")}
          formatYAxis={(value) => formatChartValue(value, "operations", true)}
          showLegend
        />
        <TimeSeriesPanel
          title="Network throughput history"
          meta={`${chartData.length} samples`}
          summary={
            latest
              ? `${formatBytes(latest.network.rxBytesPerSecond)}/s received and ${formatBytes(latest.network.txBytesPerSecond)}/s transmitted; ${latest.network.droppedPackets ?? 0} dropped packets and ${latest.network.errors ?? 0} errors.`
              : "No network samples."
          }
          data={chartData}
          lines={[
            { key: "networkRx", name: "RX B/s", color: CHART_COLORS.blue },
            { key: "networkTx", name: "TX B/s", color: CHART_COLORS.red },
          ]}
          formatValue={(value) => formatChartValue(Number(value), "bytes")}
          formatYAxis={(value) => formatChartValue(value, "bytes", true)}
          showLegend
        />

        <article className={`${styles.panel} ${styles.panelWide}`}>
          <div className={styles.panelHeader}>
            <h2>CPU cores</h2>
            <span className={styles.muted}>
              {latest?.cpu.cores.length ?? 0} cores
            </span>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.coreGrid}>
              {latest?.cpu.cores.map((usage, index) => (
                <div className={styles.coreMetric} key={index}>
                  <span>Core {index + 1}</span>
                  <strong>{formatPercent(usage)}</strong>
                  <meter
                    className={styles.meter}
                    min={0}
                    max={100}
                    value={usage}
                  />
                </div>
              ))}
            </div>
            {!latest?.cpu.cores.length && (
              <div className={styles.empty}>
                No per-core measurements reported.
              </div>
            )}
          </div>
        </article>

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
                    <td>{formatPercent(process.cpuPercent)}</td>
                    <td>{formatBytes(process.memoryBytes)}</td>
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

        {isAdmin && latest && (
          <>
            <AdminTable
              title="Disk partitions"
              headers={["Mount", "Used", "Free", "Capacity", "Pressure"]}
              rows={(latest.disk.partitions ?? []).map((partition) => [
                partition.mount,
                formatBytes(partition.usedBytes),
                formatBytes(partition.freeBytes),
                formatBytes(partition.totalBytes),
                formatPercent(partition.usePercent),
              ])}
              empty="No partition telemetry reported."
            />
            <AdminTable
              title="Network interfaces"
              headers={["Interface", "State", "RX", "TX", "Dropped", "Errors"]}
              rows={(latest.network.interfaces ?? []).map((item) => [
                item.name,
                item.state,
                `${formatBytes(item.rxBytesPerSecond)}/s`,
                `${formatBytes(item.txBytesPerSecond)}/s`,
                item.droppedPackets,
                item.errors,
              ])}
              empty="No interface telemetry reported."
            />
            <ProcessTable
              title="Top OS processes by CPU"
              processes={latest.topProcesses?.cpu ?? []}
            />
            <ProcessTable
              title="Top OS processes by memory"
              processes={latest.topProcesses?.memory ?? []}
            />
          </>
        )}
      </section>
    </main>
  );
}

function AdminTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  empty: string;
}) {
  return (
    <article className={`${styles.panel} ${styles.panelWide}`}>
      <div className={styles.panelHeader}>
        <h2>{title}</h2>
        <StatusBadge tone="warning">Admin only</StatusBadge>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className={styles.empty}>{empty}</div>}
      </div>
    </article>
  );
}
function ProcessTable({
  title,
  processes,
}: {
  title: string;
  processes: OsProcessMetric[];
}) {
  return (
    <AdminTable
      title={title}
      headers={["Name", "PID", "CPU", "Memory"]}
      rows={processes.map((process) => [
        process.name,
        process.pid,
        formatPercent(process.cpuPercent),
        formatBytes(process.memoryBytes),
      ])}
      empty="No OS process telemetry reported."
    />
  );
}
function formatChartValue(
  value: number,
  kind: ChartValueKind,
  compact = false,
): string {
  if (kind === "percent")
    return compact ? `${value.toFixed(0)}%` : formatPercent(value);
  if (kind === "operations")
    return compact ? value.toFixed(0) : `${value.toFixed(1)} op/s`;
  return compact ? formatCompactBytes(value) : `${formatBytes(value)}/s`;
}
function diskWaitSummary(disk: MetricSnapshot["disk"]): string {
  if (
    disk.readWaitMilliseconds !== undefined ||
    disk.writeWaitMilliseconds !== undefined
  ) {
    return `read wait ${formatMilliseconds(disk.readWaitMilliseconds)}, write wait ${formatMilliseconds(disk.writeWaitMilliseconds)}`;
  }
  return `wait ${formatMilliseconds(disk.waitMilliseconds)}`;
}
