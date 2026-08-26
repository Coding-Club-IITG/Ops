"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/api";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { ChartTooltip } from "@/components/ChartTooltip";
import type { MetricSnapshot, OsProcessMetric } from "@/types/ops.types";
import { usePolling } from "@/features/ops/use-polling";
import styles from "@/features/ops/ops.module.scss";

type Range = "1h" | "6h" | "24h" | "7d" | "30d";
type ChartLine = { key: string; name: string; color: string };
type ChartValueKind = "percent" | "operations" | "bytes";

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
        operatorRole: "viewer" | "admin";
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

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Time series</p>
          <h1 className={styles.heading}>Host metrics</h1>
          <p className={styles.subheading}>
            Read-only aggregate host and PM2 telemetry, along with detailed OS
            telemetry for admins.
          </p>
        </div>
        <div className={styles.headerActions}>
          <StatusBadge tone={sampleStatus.tone}>
            {sampleStatus.label}
          </StatusBadge>
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
          label="CPU current"
          value={latest ? percent(latest.cpu.usagePercent) : "-"}
          detail={
            latest
              ? `Avg ${percent(cpuStats.average)} · min ${percent(cpuStats.minimum)} · max ${percent(cpuStats.maximum)}`
              : undefined
          }
        />
        <MetricStat
          label="Memory pressure"
          value={
            latest
              ? percent(
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
              ? `${bytes(latest.memory.usedBytes)} used · ${bytes(latest.memory.freeBytes ?? Math.max(0, latest.memory.totalBytes - latest.memory.usedBytes))} free`
              : undefined
          }
        />
        <MetricStat
          label="Disk operations"
          value={
            latest
              ? `${latest.disk.readsPerSecond.toFixed(1)} / ${latest.disk.writesPerSecond.toFixed(1)}`
              : "-"
          }
          detail="read / write operations per second"
        />
        <MetricStat
          label="Network"
          value={latest ? `${bytes(latest.network.rxBytesPerSecond)}/s` : "-"}
          detail={
            latest
              ? `RX · TX ${bytes(latest.network.txBytesPerSecond)}/s · ${latest.network.activeConnections} connections`
              : undefined
          }
        />

        <HistoryPanel
          title="CPU history"
          summary={
            latest
              ? `Current ${percent(latest.cpu.usagePercent)}; average ${percent(cpuStats.average)}; minimum ${percent(cpuStats.minimum)}; maximum ${percent(cpuStats.maximum)}.`
              : "No CPU samples."
          }
          data={chartData}
          lines={[{ key: "cpu", name: "CPU %", color: "#2f81f7" }]}
          valueKind="percent"
        />
        <HistoryPanel
          title="Memory history"
          summary={
            latest
              ? `${bytes(latest.memory.usedBytes)} used of ${bytes(latest.memory.totalBytes)}.`
              : "No memory samples."
          }
          data={chartData}
          lines={[{ key: "memory", name: "Used %", color: "#8957e5" }]}
          valueKind="percent"
        />
        <HistoryPanel
          title="Disk operations history"
          summary={
            latest
              ? `${latest.disk.readsPerSecond.toFixed(1)} read and ${latest.disk.writesPerSecond.toFixed(1)} write operations per second; wait ${milliseconds(latest.disk.waitMilliseconds)}.`
              : "No disk samples."
          }
          data={chartData}
          lines={[
            { key: "diskRead", name: "Read op/s", color: "#2da44e" },
            { key: "diskWrite", name: "Write op/s", color: "#d29922" },
          ]}
          valueKind="operations"
        />
        <HistoryPanel
          title="Network throughput history"
          summary={
            latest
              ? `${bytes(latest.network.rxBytesPerSecond)}/s received and ${bytes(latest.network.txBytesPerSecond)}/s transmitted; ${latest.network.droppedPackets ?? 0} dropped packets and ${latest.network.errors ?? 0} errors.`
              : "No network samples."
          }
          data={chartData}
          lines={[
            { key: "networkRx", name: "RX B/s", color: "#2f81f7" },
            { key: "networkTx", name: "TX B/s", color: "#f85149" },
          ]}
          valueKind="bytes"
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
                  <strong>{percent(usage)}</strong>
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
                    <td>{percent(process.cpuPercent)}</td>
                    <td>{bytes(process.memoryBytes)}</td>
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
                bytes(partition.usedBytes),
                bytes(partition.freeBytes),
                bytes(partition.totalBytes),
                percent(partition.usePercent),
              ])}
              empty="No partition telemetry reported."
            />
            <AdminTable
              title="Network interfaces"
              headers={["Interface", "State", "RX", "TX", "Dropped", "Errors"]}
              rows={(latest.network.interfaces ?? []).map((item) => [
                item.name,
                item.state,
                `${bytes(item.rxBytesPerSecond)}/s`,
                `${bytes(item.txBytesPerSecond)}/s`,
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

function MetricStat({
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
      {detail && <span className={styles.muted}>{detail}</span>}
    </article>
  );
}
function HistoryPanel({
  title,
  summary,
  data,
  lines,
  valueKind,
}: {
  title: string;
  summary: string;
  data: Array<Record<string, string | number>>;
  lines: ChartLine[];
  valueKind: ChartValueKind;
}) {
  return (
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>{title}</h2>
        <span className={styles.muted}>{data.length} samples</span>
      </div>
      <div className={styles.chart}>
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 12, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                minTickGap={32}
                tickFormatter={(value) =>
                  new Date(String(value)).toLocaleTimeString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
              />
              <YAxis
                width={48}
                tickFormatter={(value) =>
                  formatChartValue(Number(value), valueKind, true)
                }
              />
              <Tooltip
                cursor={{ stroke: "var(--border-input)", strokeWidth: 1 }}
                content={(props) => (
                  <ChartTooltip
                    {...props}
                    formatLabel={(value) =>
                      new Date(String(value)).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })
                    }
                    formatValue={(value) =>
                      formatChartValue(Number(value), valueKind)
                    }
                  />
                )}
              />
              <Legend />
              {lines.map((line) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.name}
                  stroke={line.color}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.empty}>No metric samples reported.</div>
        )}
      </div>
      <p className={styles.srOnly}>{summary}</p>
    </article>
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
        percent(process.cpuPercent),
        bytes(process.memoryBytes),
      ])}
      empty="No OS process telemetry reported."
    />
  );
}
function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}
function formatChartValue(
  value: number,
  kind: ChartValueKind,
  compact = false,
): string {
  if (kind === "percent")
    return compact ? `${value.toFixed(0)}%` : percent(value);
  if (kind === "operations")
    return compact ? value.toFixed(0) : `${value.toFixed(1)} op/s`;
  return compact ? compactBytes(value) : `${bytes(value)}/s`;
}
function compactBytes(value: number): string {
  if (value < 1_024) return `${value.toFixed(0)} B`;
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(0)} KiB`;
  if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(0)} MiB`;
  return `${(value / 1_024 ** 3).toFixed(1)} GiB`;
}
function bytes(value = 0): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
function milliseconds(value = 0): string {
  return `${value.toFixed(1)} ms`;
}
function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}
