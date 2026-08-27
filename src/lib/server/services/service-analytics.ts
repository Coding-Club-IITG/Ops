import type {
  LogEventProject,
  LogEventService,
} from "@contracts/log-event-v1/log-event-v1";
import { LOG_EVENT_SERVICE_DEFINITIONS } from "@contracts/log-event-v1/project-registry";
import type { MetricsRange } from "@/lib/server/logs/log-query";
import { selectLogBucketDuration } from "@/lib/server/logs/log-repository";
import { getMetricSnapshots } from "@/lib/server/metrics/metrics-store";
import { getPostgresPool } from "@/lib/server/postgres";
import { OPS_RANGE_MILLISECONDS } from "@/lib/ops-constants";

export type ServiceAnalyticsBucket = {
  timestamp: string;
  httpCount: number;
  requestRatePerSecond: number;
  http5xxCount: number;
  http5xxRate: number;
  applicationErrorCount: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
};

type AggregateRow = {
  httpCount: string;
  http5xxCount: string;
  applicationErrorCount: string;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  lastSeenAt: Date | string | null;
};

export function getRegisteredService(service: string): {
  service: LogEventService;
  project: LogEventProject;
} | null {
  const match = LOG_EVENT_SERVICE_DEFINITIONS.find(
    (definition) => definition.service === service,
  );
  return match ? { service: match.service, project: match.project } : null;
}

export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function pm2TelemetryState(
  metricSnapshotCount: number,
  saturationCount: number,
): "available" | "partial" | "unavailable" {
  if (saturationCount === 0) return "unavailable";
  return saturationCount < metricSnapshotCount ? "partial" : "available";
}

function floorUtc(timestamp: number, bucketMs: number): number {
  return Math.floor(timestamp / bucketMs) * bucketMs;
}

export function fillServiceBuckets(
  rows: Array<
    Omit<ServiceAnalyticsBucket, "timestamp"> & { timestamp: Date | string }
  >,
  from: Date,
  to: Date,
  bucketDurationSeconds: number,
): ServiceAnalyticsBucket[] {
  const bucketMs = bucketDurationSeconds * 1_000;
  const byTime = new Map(
    rows.map((row) => [
      floorUtc(new Date(row.timestamp).getTime(), bucketMs),
      row,
    ]),
  );
  const output: ServiceAnalyticsBucket[] = [];
  for (
    let timestamp = floorUtc(from.getTime(), bucketMs);
    timestamp <= floorUtc(to.getTime(), bucketMs);
    timestamp += bucketMs
  ) {
    const row = byTime.get(timestamp);
    output.push({
      timestamp: new Date(timestamp).toISOString(),
      httpCount: row?.httpCount ?? 0,
      requestRatePerSecond: row?.requestRatePerSecond ?? 0,
      http5xxCount: row?.http5xxCount ?? 0,
      http5xxRate: row?.http5xxRate ?? 0,
      applicationErrorCount: row?.applicationErrorCount ?? 0,
      latencyP50Ms: row?.latencyP50Ms ?? null,
      latencyP95Ms: row?.latencyP95Ms ?? null,
      latencyP99Ms: row?.latencyP99Ms ?? null,
    });
  }
  return output;
}

export async function getServiceAnalytics(
  service: LogEventService,
  project: LogEventProject,
  range: MetricsRange,
  now = new Date(),
) {
  const from = new Date(now.getTime() - OPS_RANGE_MILLISECONDS[range]);
  const bucketDurationSeconds = selectLogBucketDuration(
    OPS_RANGE_MILLISECONDS[range],
  );
  const interval = `${bucketDurationSeconds} seconds`;
  const [aggregateResult, bucketResult, metricSnapshots] = await Promise.all([
    getPostgresPool().query<AggregateRow>(
      `SELECT
        COUNT(*) FILTER (WHERE kind = 'http') AS "httpCount",
        COUNT(*) FILTER (WHERE kind = 'http' AND http_status_code >= 500) AS "http5xxCount",
        COUNT(*) FILTER (WHERE kind = 'application' AND level IN ('error', 'fatal')) AS "applicationErrorCount",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY http_duration_ms) FILTER (WHERE kind = 'http') AS "latencyP50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY http_duration_ms) FILTER (WHERE kind = 'http') AS "latencyP95Ms",
        percentile_cont(0.99) WITHIN GROUP (ORDER BY http_duration_ms) FILTER (WHERE kind = 'http') AS "latencyP99Ms",
        MAX(occurred_at) AS "lastSeenAt"
       FROM ops.log_events
       WHERE service = $1 AND occurred_at >= $2 AND occurred_at <= $3`,
      [service, from, now],
    ),
    getPostgresPool().query<{
      timestamp: Date | string;
      httpCount: string;
      http5xxCount: string;
      applicationErrorCount: string;
      latencyP50Ms: number | null;
      latencyP95Ms: number | null;
      latencyP99Ms: number | null;
    }>(
      `SELECT
        date_bin($1::interval, occurred_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS timestamp,
        COUNT(*) FILTER (WHERE kind = 'http') AS "httpCount",
        COUNT(*) FILTER (WHERE kind = 'http' AND http_status_code >= 500) AS "http5xxCount",
        COUNT(*) FILTER (WHERE kind = 'application' AND level IN ('error', 'fatal')) AS "applicationErrorCount",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY http_duration_ms) FILTER (WHERE kind = 'http') AS "latencyP50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY http_duration_ms) FILTER (WHERE kind = 'http') AS "latencyP95Ms",
        percentile_cont(0.99) WITHIN GROUP (ORDER BY http_duration_ms) FILTER (WHERE kind = 'http') AS "latencyP99Ms"
       FROM ops.log_events
       WHERE service = $2 AND occurred_at >= $3 AND occurred_at <= $4
       GROUP BY 1 ORDER BY 1 ASC`,
      [interval, service, from, now],
    ),
    getMetricSnapshots(range),
  ]);

  const aggregate = aggregateResult.rows[0];
  const httpCount = Number(aggregate?.httpCount ?? 0);
  const http5xxCount = Number(aggregate?.http5xxCount ?? 0);
  const rawBuckets = bucketResult.rows.map((row) => {
    const bucketHttpCount = Number(row.httpCount);
    const bucket5xxCount = Number(row.http5xxCount);
    return {
      timestamp: row.timestamp,
      httpCount: bucketHttpCount,
      requestRatePerSecond: bucketHttpCount / bucketDurationSeconds,
      http5xxCount: bucket5xxCount,
      http5xxRate: bucketHttpCount ? bucket5xxCount / bucketHttpCount : 0,
      applicationErrorCount: Number(row.applicationErrorCount),
      latencyP50Ms: row.latencyP50Ms === null ? null : Number(row.latencyP50Ms),
      latencyP95Ms: row.latencyP95Ms === null ? null : Number(row.latencyP95Ms),
      latencyP99Ms: row.latencyP99Ms === null ? null : Number(row.latencyP99Ms),
    };
  });
  const saturation = metricSnapshots.flatMap((snapshot) => {
    const process = snapshot.pm2.find((metric) => metric.name === service);
    return process
      ? [
          {
            timestamp: new Date(snapshot.measuredAt).toISOString(),
            cpuPercent: process.cpuPercent,
            memoryBytes:
              process.memoryBytes ?? (process.memoryMb ?? 0) * 1_024 * 1_024,
          },
        ]
      : [];
  });
  const metricsLastSeenAt = saturation.at(-1)?.timestamp ?? null;
  const eventsLastSeenAt = aggregate?.lastSeenAt
    ? new Date(aggregate.lastSeenAt).toISOString()
    : null;
  const pm2Telemetry = pm2TelemetryState(
    metricSnapshots.length,
    saturation.length,
  );

  return {
    service,
    project,
    range,
    bucketDurationSeconds,
    summary: {
      httpCount,
      requestRatePerSecond: httpCount / (OPS_RANGE_MILLISECONDS[range] / 1_000),
      http5xxCount,
      http5xxRate: httpCount ? http5xxCount / httpCount : 0,
      applicationErrorCount: Number(aggregate?.applicationErrorCount ?? 0),
      latencyP50Ms:
        aggregate?.latencyP50Ms === null
          ? null
          : Number(aggregate?.latencyP50Ms),
      latencyP95Ms:
        aggregate?.latencyP95Ms === null
          ? null
          : Number(aggregate?.latencyP95Ms),
      latencyP99Ms:
        aggregate?.latencyP99Ms === null
          ? null
          : Number(aggregate?.latencyP99Ms),
    },
    buckets: fillServiceBuckets(rawBuckets, from, now, bucketDurationSeconds),
    saturation,
    freshness: {
      eventsLastSeenAt,
      metricsLastSeenAt,
      eventsStale:
        !eventsLastSeenAt ||
        now.getTime() - Date.parse(eventsLastSeenAt) > 60_000,
      metricsStale:
        !metricsLastSeenAt ||
        now.getTime() - Date.parse(metricsLastSeenAt) > 60_000,
    },
    pm2Telemetry,
    partial:
      (httpCount > 0 && saturation.length === 0) || pm2Telemetry === "partial",
    fetchedAt: now.toISOString(),
  } as const;
}
