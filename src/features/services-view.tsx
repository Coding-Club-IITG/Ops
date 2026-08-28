"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LOG_EVENT_PROJECT_REGISTRY } from "@contract/project-registry";
import { StatusBadge } from "@/components/StatusBadge";
import { usePolling } from "@/features/use-polling";
import { RangeSelect } from "@/features/range-select";
import { StatCard } from "@/features/stat-card";
import {
  TimeSeriesPanel,
  type TimeSeriesDatum,
} from "@/features/time-series-panel";
import {
  SERVICE_STATUS_TONES,
  telemetryStatusTone,
} from "@/features/status-tones";
import { apiFetch } from "@/lib/api";
import {
  formatBytes,
  formatIndianNumber,
  formatMilliseconds,
  formatShortIst,
} from "@/lib/formatters";
import {
  CHART_COLORS,
  DEFAULT_SERVICE_RANGE,
  isOpsRange,
  type OpsRange,
} from "@/lib/ops-constants";
import type { ServiceAnalytics, ServiceSummary } from "@/types/ops.types";
import styles from "@/features/ops.module.scss";

export function ServicesView({ service }: { service?: string }) {
  return service ? <ServiceDetail service={service} /> : <ServiceDirectory />;
}

function ServiceDirectory() {
  const load = useCallback(
    async () => (await apiFetch("/services")) as { data: ServiceSummary[] },
    [],
  );
  const { data, loading, error } = usePolling(load);
  const summaries = new Map(data?.data.map((item) => [item.service, item]));
  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Golden signals</p>
          <h1 className={styles.heading}>Services</h1>
          <p className={styles.subheading}>
            Registered production services with event freshness and analytics.
          </p>
        </div>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <section className={styles.serviceDirectory} aria-busy={loading}>
        {LOG_EVENT_PROJECT_REGISTRY.flatMap((project) =>
          project.services.map((registered) => {
            const summary = summaries.get(registered.id);
            return (
              <Link
                className={styles.serviceCard}
                href={`/services/${registered.id}?range=24h`}
                key={registered.id}
              >
                <div>
                  <span className={styles.muted}>{project.name}</span>
                  <h2>{registered.name}</h2>
                  <span className={styles.mono}>{registered.id}</span>
                </div>
                <StatusBadge
                  tone={SERVICE_STATUS_TONES[summary?.status ?? "unknown"]}
                >
                  {summary?.status ?? "unknown"}
                </StatusBadge>
                <span className={styles.muted}>
                  {summary?.lastSeenAt
                    ? `Last event ${formatShortIst(summary.lastSeenAt)}`
                    : "No retained events"}
                </span>
              </Link>
            );
          }),
        )}
      </section>
    </main>
  );
}

function ServiceDetail({ service }: { service: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const candidate = searchParams.get("range");
  const range: OpsRange = isOpsRange(candidate)
    ? candidate
    : DEFAULT_SERVICE_RANGE;
  const load = useCallback(
    () =>
      apiFetch(
        `/services/${encodeURIComponent(service)}/analytics`,
        {},
        { range },
      ) as Promise<ServiceAnalytics>,
    [range, service],
  );
  const { data, loading, error } = usePolling(load);
  const chartData = useMemo<TimeSeriesDatum[]>(
    () => (data?.buckets ?? []).map((bucket) => ({ ...bucket })),
    [data],
  );
  const setRange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };
  useEffect(() => {
    if (isOpsRange(candidate)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", DEFAULT_SERVICE_RANGE);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [candidate, pathname, router, searchParams]);
  const noEvents = Boolean(
    data &&
    data.summary.httpCount === 0 &&
    data.summary.applicationErrorCount === 0,
  );

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>
            <Link href="/services">Services</Link> /{" "}
            {data?.project ?? "registered"}
          </p>
          <h1 className={styles.heading}>{service}</h1>
          <p className={styles.subheading}>
            Traffic, errors, latency, and PM2 saturation.
          </p>
        </div>
        <div className={styles.headerActions}>
          {data?.partial && (
            <StatusBadge tone="warning">Partial data</StatusBadge>
          )}
          {data?.freshness.eventsStale && (
            <StatusBadge tone="warning">Events stale</StatusBadge>
          )}
          <RangeSelect
            label="Service analytics range"
            value={range}
            onChange={setRange}
          />
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          Service analytics are unavailable.
        </p>
      )}
      {loading && !data && (
        <div className={styles.empty}>Loading service analytics…</div>
      )}
      {noEvents && (
        <div className={styles.empty}>
          No retained HTTP or application error events exist for this service
          and range.
        </div>
      )}
      {data && (
        <section className={styles.grid}>
          <StatCard
            label="Traffic"
            value={`${formatIndianNumber(data.summary.httpCount)} requests`}
            detail={`${data.summary.requestRatePerSecond.toFixed(3)} req/s`}
          />
          <StatCard
            label="HTTP 5xx"
            value={`${formatIndianNumber(data.summary.http5xxCount)} · ${(data.summary.http5xxRate * 100).toFixed(2)}%`}
          />
          <StatCard
            label="Application errors"
            value={formatIndianNumber(data.summary.applicationErrorCount)}
            detail="error and fatal events"
          />
          <StatCard
            label="Latency p95"
            value={formatMs(data.summary.latencyP95Ms)}
            detail={`p50 ${formatMs(data.summary.latencyP50Ms)} · p99 ${formatMs(data.summary.latencyP99Ms)}`}
          />

          <TimeSeriesPanel
            title="Traffic"
            meta="UTC buckets · shown in IST"
            data={chartData}
            lines={[
              {
                key: "requestRatePerSecond",
                name: "Requests/s",
                color: CHART_COLORS.blue,
              },
            ]}
            formatValue={(value) => `${Number(value).toFixed(3)} req/s`}
            fullWidth
          />
          <TimeSeriesPanel
            title="Errors"
            meta="UTC buckets · shown in IST"
            data={chartData}
            lines={[
              {
                key: "http5xxCount",
                name: "HTTP 5xx",
                color: CHART_COLORS.red,
              },
              {
                key: "applicationErrorCount",
                name: "Application error/fatal",
                color: CHART_COLORS.yellow,
              },
            ]}
            formatValue={(value) =>
              `${formatIndianNumber(Number(value))} events`
            }
            fullWidth
          />
          <TimeSeriesPanel
            title="Latency"
            meta="UTC buckets · shown in IST"
            data={chartData}
            lines={[
              {
                key: "latencyP50Ms",
                name: "p50",
                color: CHART_COLORS.green,
              },
              {
                key: "latencyP95Ms",
                name: "p95",
                color: CHART_COLORS.purple,
              },
              {
                key: "latencyP99Ms",
                name: "p99",
                color: CHART_COLORS.red,
              },
            ]}
            formatValue={(value) => formatMilliseconds(Number(value))}
            fullWidth
          />
          <TimeSeriesPanel
            title="Saturation"
            meta={
              <StatusBadge tone={telemetryStatusTone(data.pm2Telemetry)}>
                {data.pm2Telemetry === "unavailable"
                  ? "PM2 telemetry unavailable"
                  : `${data.pm2Telemetry} PM2 telemetry`}
              </StatusBadge>
            }
            data={data.saturation.map((sample) => ({ ...sample }))}
            lines={[
              { key: "cpuPercent", name: "CPU", color: CHART_COLORS.blue },
              {
                key: "memoryBytes",
                name: "Memory",
                color: CHART_COLORS.purple,
              },
            ]}
            formatValue={(value, name) =>
              name === "Memory"
                ? formatBytes(Number(value))
                : `${Number(value).toFixed(1)}%`
            }
            empty="PM2 telemetry unavailable."
            fullWidth
          />
        </section>
      )}
    </main>
  );
}

function formatMs(value: number | null): string {
  return value === null ? "-" : formatMilliseconds(value);
}
