import type {
  MetricDimensionValue,
  MetricEventV1,
  MetricEventValidationIssue,
} from "@contract/metric-event-v1";
import { z } from "zod";
import { getPostgresPool } from "@/lib/server/postgres";

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const dimensionKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const scalar = z.union([
  z.string().min(1).max(256),
  z.number().finite(),
  z.boolean(),
]);

export const metricCatalogQuerySchema = z
  .object({
    project: identifier.optional(),
    service: identifier.optional(),
    metric: identifier.optional(),
  })
  .strict();

export const projectMetricQuerySchema = z
  .object({
    project: identifier,
    service: identifier.optional(),
    metric: identifier,
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    filters: z.record(dimensionKey, scalar).default({}),
    groupBy: z.array(dimensionKey).max(6).default([]),
  })
  .strict()
  .superRefine((query, context) => {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (from > to)
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must not be after to",
      });
    if (to - from > 90 * 24 * 60 * 60 * 1_000)
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Metric ranges cannot exceed 90 days",
      });
    if (new Set(query.groupBy).size !== query.groupBy.length)
      context.addIssue({
        code: "custom",
        path: ["groupBy"],
        message: "Grouping keys must be unique",
      });
  });

export type ProjectMetricQuery = z.infer<typeof projectMetricQuerySchema>;
export type MetricCatalogQuery = z.infer<typeof metricCatalogQuerySchema>;
export type MetricGroup = {
  dimensions: Record<string, MetricDimensionValue>;
  summedValue: number;
  eventCount: number;
};
export type MetricSeriesPoint = MetricGroup & { timestamp: string };
export const PROJECT_METRIC_GROUP_LIMIT = 100;
export const PROJECT_METRIC_CHART_GROUP_LIMIT = 12;
export const PROJECT_METRIC_CATALOG_VALUE_LIMIT = 100;

type QueryParts = { conditions: string[]; values: unknown[] };

function add(parts: QueryParts, sql: string, value: unknown): void {
  parts.values.push(value);
  parts.conditions.push(`${sql} $${parts.values.length}`);
}

export function buildProjectMetricWhere(query: ProjectMetricQuery): QueryParts {
  const parts: QueryParts = { conditions: [], values: [] };
  add(parts, "project =", query.project);
  if (query.service) add(parts, "service =", query.service);
  add(parts, "metric_name =", query.metric);
  add(parts, "occurred_at >=", query.from);
  add(parts, "occurred_at <=", query.to);
  if (Object.keys(query.filters).length) {
    parts.values.push(JSON.stringify(query.filters));
    parts.conditions.push(`dimensions @> $${parts.values.length}::jsonb`);
  }
  return parts;
}

export function selectMetricBucketDuration(rangeMilliseconds: number): number {
  if (rangeMilliseconds <= 60 * 60 * 1_000) return 60;
  if (rangeMilliseconds <= 6 * 60 * 60 * 1_000) return 5 * 60;
  if (rangeMilliseconds <= 24 * 60 * 60 * 1_000) return 15 * 60;
  if (rangeMilliseconds <= 7 * 24 * 60 * 60 * 1_000) return 60 * 60;
  if (rangeMilliseconds <= 30 * 24 * 60 * 60 * 1_000) return 6 * 60 * 60;
  return 24 * 60 * 60;
}

export function buildMetricGrouping(
  groupBy: string[],
  values: unknown[],
  dimensions = "dimensions",
): string {
  if (!groupBy.length) return "'{}'::jsonb";
  const pairs = groupBy.flatMap((key) => {
    values.push(key);
    const parameter = `$${values.length}`;
    return [`${parameter}::text`, `${dimensions} -> ${parameter}::text`];
  });
  return `jsonb_strip_nulls(jsonb_build_object(${pairs.join(", ")}))`;
}

function number(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function buildMetricSeriesBuckets(
  rows: MetricSeriesPoint[],
  groups: MetricGroup[],
  from: string,
  to: string,
  bucketDurationSeconds: number,
): MetricSeriesPoint[] {
  const bucketMilliseconds = bucketDurationSeconds * 1_000;
  const first =
    Math.floor(Date.parse(from) / bucketMilliseconds) * bucketMilliseconds;
  const last =
    Math.floor(Date.parse(to) / bucketMilliseconds) * bucketMilliseconds;
  const topGroups = groups.slice(0, PROJECT_METRIC_CHART_GROUP_LIMIT);
  const points = new Map<string, MetricSeriesPoint>();
  const key = (
    timestamp: number,
    dimensions: Record<string, MetricDimensionValue>,
  ) => `${timestamp}:${JSON.stringify(dimensions)}`;

  for (
    let timestamp = first;
    timestamp <= last;
    timestamp += bucketMilliseconds
  ) {
    for (const group of topGroups) {
      points.set(key(timestamp, group.dimensions), {
        timestamp: new Date(timestamp).toISOString(),
        dimensions: group.dimensions,
        summedValue: 0,
        eventCount: 0,
      });
    }
  }
  for (const row of rows) {
    const timestamp =
      Math.floor(Date.parse(row.timestamp) / bucketMilliseconds) *
      bucketMilliseconds;
    const pointKey = key(timestamp, row.dimensions);
    if (points.has(pointKey))
      points.set(pointKey, {
        ...row,
        timestamp: new Date(timestamp).toISOString(),
      });
  }
  return [...points.values()].sort(
    (left, right) =>
      Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
      JSON.stringify(left.dimensions).localeCompare(
        JSON.stringify(right.dimensions),
      ),
  );
}

export function limitMetricGroups(rows: MetricGroup[]): {
  groups: MetricGroup[];
  truncated: boolean;
} {
  return {
    groups: rows.slice(0, PROJECT_METRIC_GROUP_LIMIT),
    truncated: rows.length > PROJECT_METRIC_GROUP_LIMIT,
  };
}

export async function insertMetricEvent(
  event: MetricEventV1,
): Promise<boolean> {
  const result = await getPostgresPool().query(
    `INSERT INTO ops.metric_events
      (event_id, schema_version, occurred_at, project, service, metric_name, value, dimensions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      event.eventId,
      event.schemaVersion,
      event.timestamp,
      event.project,
      event.service,
      event.name,
      event.value,
      event.dimensions,
    ],
  );
  return result.rowCount === 1;
}

export async function storeMetricDeadLetter(input: {
  streamId: string;
  payloadHash: string;
  failureCode: "invalid_json" | "contract_rejected";
  validationIssues: MetricEventValidationIssue[];
  deliveryCount: number;
}): Promise<void> {
  await getPostgresPool().query(
    `INSERT INTO ops.metric_dead_letters
      (stream_id, payload_sha256, failure_code, validation_issues, delivery_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (stream_id) DO NOTHING`,
    [
      input.streamId,
      input.payloadHash,
      input.failureCode,
      JSON.stringify(input.validationIssues),
      input.deliveryCount,
    ],
  );
}

export async function deleteExpiredMetricEvents(
  retentionDays = 90,
): Promise<number> {
  const result = await getPostgresPool().query(
    "DELETE FROM ops.metric_events WHERE occurred_at < NOW() - ($1 * INTERVAL '1 day')",
    [retentionDays],
  );
  return result.rowCount ?? 0;
}

export async function getMetricCatalog(selection: MetricCatalogQuery) {
  const catalogConditions = ["occurred_at >= NOW() - INTERVAL '90 days'"];
  const values: unknown[] = [];
  const condition = (sql: string, value: string | undefined) => {
    if (!value) return;
    values.push(value);
    catalogConditions.push(`${sql} $${values.length}`);
  };
  condition("project =", selection.project);
  condition("service =", selection.service);
  const scopedWhere = `WHERE ${catalogConditions.join(" AND ")}`;

  const [projectsResult, metricsResult] = await Promise.all([
    getPostgresPool().query<{ project: string; services: string[] }>(
      `SELECT project, array_agg(DISTINCT service ORDER BY service) AS services
       FROM ops.metric_events
       WHERE occurred_at >= NOW() - INTERVAL '90 days'
       GROUP BY project ORDER BY project`,
    ),
    getPostgresPool().query<{ name: string }>(
      `SELECT DISTINCT metric_name AS name FROM ops.metric_events ${scopedWhere} ORDER BY name`,
      values,
    ),
  ]);

  let dimensions: Array<{ key: string; values: MetricDimensionValue[] }> = [];
  if (selection.project && selection.metric) {
    const dimensionValues = [...values, selection.metric];
    const dimensionWhere = `${scopedWhere} AND metric_name = $${dimensionValues.length}`;
    const result = await getPostgresPool().query<{
      key: string;
      values: MetricDimensionValue[];
    }>(
      `WITH observed AS (
         SELECT dimension.key, dimension.value, MAX(occurred_at) AS last_seen
         FROM ops.metric_events CROSS JOIN LATERAL jsonb_each(dimensions) AS dimension
         ${dimensionWhere}
         GROUP BY dimension.key, dimension.value
       ), ranked AS (
         SELECT key, value, last_seen,
           ROW_NUMBER() OVER (PARTITION BY key ORDER BY last_seen DESC, value::text) AS rank
         FROM observed
       )
       SELECT key, jsonb_agg(value ORDER BY last_seen DESC, value::text) AS values
       FROM ranked WHERE rank <= ${PROJECT_METRIC_CATALOG_VALUE_LIMIT} GROUP BY key ORDER BY key`,
      dimensionValues,
    );
    dimensions = result.rows;
  }
  return {
    projects: projectsResult.rows,
    metrics: metricsResult.rows.map((row) => row.name),
    dimensions,
  };
}

export async function queryProjectMetrics(query: ProjectMetricQuery) {
  const base = buildProjectMetricWhere(query);
  const where = `WHERE ${base.conditions.join(" AND ")}`;
  const pool = getPostgresPool();
  const totalsResult = await pool.query<{
    summedValue: string;
    eventCount: string;
  }>(
    `SELECT COALESCE(SUM(value), 0) AS "summedValue", COUNT(*) AS "eventCount"
     FROM ops.metric_events ${where}`,
    base.values,
  );

  const groupedValues = [...base.values];
  const combination = buildMetricGrouping(query.groupBy, groupedValues);
  const groupedResult = await pool.query<{
    dimensions: Record<string, MetricDimensionValue>;
    summedValue: string;
    eventCount: string;
  }>(
    `SELECT ${combination} AS dimensions, SUM(value) AS "summedValue", COUNT(*) AS "eventCount"
     FROM ops.metric_events ${where}
     GROUP BY ${combination}
     ORDER BY "summedValue" DESC, "eventCount" DESC, ${combination}::text ASC
     LIMIT ${PROJECT_METRIC_GROUP_LIMIT + 1}`,
    groupedValues,
  );
  const limited = limitMetricGroups(
    groupedResult.rows.map((row) => ({
      dimensions: row.dimensions,
      summedValue: number(row.summedValue),
      eventCount: number(row.eventCount),
    })),
  );
  const { groups, truncated } = limited;

  const bucketDurationSeconds = selectMetricBucketDuration(
    Date.parse(query.to) - Date.parse(query.from),
  );
  const seriesValues = [...base.values];
  const topCombination = buildMetricGrouping(query.groupBy, seriesValues);
  const bucketParameter = `$${seriesValues.push(`${bucketDurationSeconds} seconds`)}`;
  const seriesResult = groups.length
    ? await pool.query<{
        timestamp: Date | string;
        dimensions: Record<string, MetricDimensionValue>;
        summedValue: string;
        eventCount: string;
      }>(
        `WITH base AS (
           SELECT occurred_at, value, dimensions FROM ops.metric_events ${where}
         ), top_groups AS (
           SELECT ${topCombination} AS combination, SUM(value) AS total, COUNT(*) AS count
           FROM base GROUP BY ${topCombination}
           ORDER BY total DESC, count DESC, ${topCombination}::text ASC LIMIT ${PROJECT_METRIC_CHART_GROUP_LIMIT}
         )
         SELECT date_bin(${bucketParameter}::interval, occurred_at, TIMESTAMPTZ '1970-01-01') AS timestamp,
           ${topCombination} AS dimensions, SUM(value) AS "summedValue", COUNT(*) AS "eventCount"
         FROM base JOIN top_groups ON ${topCombination} = top_groups.combination
         GROUP BY timestamp, ${topCombination} ORDER BY timestamp ASC`,
        seriesValues,
      )
    : { rows: [] };

  const observedSeries = seriesResult.rows.map((row) => ({
    timestamp: new Date(row.timestamp).toISOString(),
    dimensions: row.dimensions,
    summedValue: number(row.summedValue),
    eventCount: number(row.eventCount),
  }));

  return {
    range: { from: query.from, to: query.to },
    bucketDurationSeconds,
    totals: {
      summedValue: number(totalsResult.rows[0]?.summedValue ?? 0),
      eventCount: number(totalsResult.rows[0]?.eventCount ?? 0),
    },
    groups,
    series: buildMetricSeriesBuckets(
      observedSeries,
      groups,
      query.from,
      query.to,
      bucketDurationSeconds,
    ),
    chartGroupLimit: PROJECT_METRIC_CHART_GROUP_LIMIT,
    groupLimit: PROJECT_METRIC_GROUP_LIMIT,
    truncated,
  };
}
