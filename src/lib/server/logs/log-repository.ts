import type { LogEventV1 } from "@contracts/log-event-v1/log-event-v1";
import { getPostgresPool } from "@/lib/server/postgres";
import type { LogsQuery } from "@/lib/server/logs/log-query";
import { LOG_EVENT_SERVICE_DEFINITIONS } from "@contracts/log-event-v1/project-registry";
import type { LogDiagnostic } from "@/lib/server/logs/log-diagnostics";
import { CORRELATION_TIMELINE_LIMIT } from "@/lib/ops-constants";

export type StoredLogEvent = LogEventV1 & {
  ingestedAt: string;
  diagnostic: {
    fingerprint: string;
    redactionCount: number;
    available: boolean;
  } | null;
};

export function serializeDiagnosticJson(diagnostic: LogDiagnostic): {
  frames: string;
  cause: string | null;
} {
  return {
    frames: JSON.stringify(diagnostic.frames),
    cause: diagnostic.cause ? JSON.stringify(diagnostic.cause) : null,
  };
}

export type LogQueryParts = { conditions: string[]; values: unknown[] };

function addCondition(parts: LogQueryParts, sql: string, value: unknown): void {
  parts.values.push(value);
  parts.conditions.push(`${sql} $${parts.values.length}`);
}

export function buildLogWhere(query: LogsQuery): LogQueryParts {
  const parts: LogQueryParts = { conditions: [], values: [] };
  if (query.from) addCondition(parts, "occurred_at >=", query.from);
  if (query.to) addCondition(parts, "occurred_at <=", query.to);
  if (query.eventId) addCondition(parts, "event_id =", query.eventId);
  if (query.project) addCondition(parts, "project =", query.project);
  if (query.service) addCondition(parts, "service =", query.service);
  if (query.kind) addCondition(parts, "kind =", query.kind);
  if (query.level) addCondition(parts, "level =", query.level);
  if (query.correlationId)
    addCondition(parts, "correlation_id =", query.correlationId);
  if (query.method) addCondition(parts, "http_method =", query.method);
  if (query.route) addCondition(parts, "http_route =", query.route);
  if (query.statusCode)
    addCondition(parts, "http_status_code =", query.statusCode);
  if (query.statusClass) {
    const statusBase = Number(query.statusClass[0]) * 100;
    addCondition(parts, "http_status_code >=", statusBase);
    addCondition(parts, "http_status_code <=", statusBase + 99);
  }
  if (query.durationMin !== undefined)
    addCondition(parts, "http_duration_ms >=", query.durationMin);
  if (query.durationMax !== undefined)
    addCondition(parts, "http_duration_ms <=", query.durationMax);
  if (query.q) {
    parts.values.push(query.q);
    parts.conditions.push(
      `search_vector @@ websearch_to_tsquery('simple', $${parts.values.length})`,
    );
  }
  return parts;
}

const SELECT_COLUMNS = `
  event_id AS "eventId",
  schema_version AS "schemaVersion",
  occurred_at AS "timestamp",
  project,
  service,
  environment,
  kind,
  level,
  message,
  correlation_id AS "correlationId",
  CASE WHEN http_method IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'method', http_method,
    'route', http_route,
    'statusCode', http_status_code,
    'durationMs', http_duration_ms,
    'requestBytes', http_request_bytes,
    'responseBytes', http_response_bytes
  )) END AS http,
  CASE WHEN error_name IS NULL AND error_code IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'name', error_name,
    'code', error_code
  )) END AS error,
  CASE WHEN diagnostic_fingerprint IS NULL THEN NULL ELSE jsonb_build_object(
    'fingerprint', diagnostic_fingerprint,
    'redactionCount', diagnostic_redaction_count,
    'available', diagnostic_available
  ) END AS diagnostic,
  attributes,
  ingested_at AS "ingestedAt"`;

export async function listLogs(
  query: LogsQuery,
): Promise<{ data: StoredLogEvent[]; total: number }> {
  const { conditions, values } = buildLogWhere(query);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortColumn =
    query.sort === "durationMs" ? "http_duration_ms" : "occurred_at";
  values.push(query.limit, query.offset);

  const result = await getPostgresPool().query<
    StoredLogEvent & { totalCount: string }
  >(
    `
    SELECT ${SELECT_COLUMNS}, COUNT(*) OVER() AS "totalCount"
    FROM ops.log_events
    ${where}
    ORDER BY ${sortColumn} ${query.order === "asc" ? "ASC" : "DESC"} NULLS LAST, event_id DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `,
    values,
  );

  return {
    data: result.rows.map(
      ({ totalCount: _totalCount, ...event }) => event as StoredLogEvent,
    ),
    total: result.rows[0] ? Number(result.rows[0].totalCount) : 0,
  };
}

export async function listCorrelationTimeline(
  correlationId: string,
): Promise<{ data: LogEventV1[]; total: number; truncated: boolean }> {
  const result = await getPostgresPool().query<
    LogEventV1 & { totalCount: string }
  >(
    `SELECT
      event_id AS "eventId",
      schema_version AS "schemaVersion",
      occurred_at AS "timestamp",
      project,
      service,
      environment,
      kind,
      level,
      message,
      correlation_id AS "correlationId",
      CASE WHEN http_method IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
        'method', http_method, 'route', http_route, 'statusCode', http_status_code,
        'durationMs', http_duration_ms, 'requestBytes', http_request_bytes,
        'responseBytes', http_response_bytes
      )) END AS http,
      CASE WHEN error_name IS NULL AND error_code IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
        'name', error_name, 'code', error_code
      )) END AS error,
      attributes,
      COUNT(*) OVER() AS "totalCount"
     FROM ops.log_events
     WHERE correlation_id = $1
       AND occurred_at >= NOW() - INTERVAL '30 days'
     ORDER BY occurred_at ASC, event_id ASC
     LIMIT $2`,
    [correlationId, CORRELATION_TIMELINE_LIMIT],
  );
  const total = result.rows[0] ? Number(result.rows[0].totalCount) : 0;
  return {
    data: result.rows.map(
      ({
        totalCount: _totalCount,
        timestamp,
        correlationId,
        http,
        error,
        attributes,
        ...event
      }) =>
        ({
          ...event,
          timestamp: new Date(timestamp).toISOString(),
          ...(correlationId ? { correlationId } : {}),
          ...(http ? { http } : {}),
          ...(error ? { error } : {}),
          ...(attributes && Object.keys(attributes).length
            ? { attributes }
            : {}),
        }) as LogEventV1,
    ),
    total,
    truncated: total > CORRELATION_TIMELINE_LIMIT,
  };
}

export async function insertLogEvent(
  event: LogEventV1,
  diagnostic?: LogDiagnostic,
): Promise<boolean> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ event_id: string }>(
      `
    INSERT INTO ops.log_events (
      event_id, schema_version, occurred_at, project, service, environment, kind, level,
      message, correlation_id, http_method, http_route, http_status_code, http_duration_ms,
      http_request_bytes, http_response_bytes, error_name, error_code, attributes,
      diagnostic_fingerprint, diagnostic_redaction_count, diagnostic_available
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
    )
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `,
      [
        event.eventId,
        event.schemaVersion,
        event.timestamp,
        event.project,
        event.service,
        event.environment,
        event.kind,
        event.level,
        event.message,
        event.correlationId ?? null,
        event.http?.method ?? null,
        event.http?.route ?? null,
        event.http?.statusCode ?? null,
        event.http?.durationMs ?? null,
        event.http?.requestBytes ?? null,
        event.http?.responseBytes ?? null,
        event.error?.name ?? null,
        event.error?.code ?? null,
        event.attributes ?? {},
        diagnostic?.fingerprint ?? null,
        diagnostic?.redactionCount ?? 0,
        Boolean(diagnostic),
      ],
    );
    if (result.rowCount === 1 && diagnostic) {
      const diagnosticJson = serializeDiagnosticJson(diagnostic);
      await client.query(
        `INSERT INTO ops.log_event_diagnostics
          (event_id, message, frames, cause, fingerprint, redaction_count)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          event.eventId,
          diagnostic.message,
          diagnosticJson.frames,
          diagnosticJson.cause,
          diagnostic.fingerprint,
          diagnostic.redactionCount,
        ],
      );
    }
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getLogDiagnostic(
  eventId: string,
): Promise<(LogDiagnostic & { service: string }) | null> {
  const result = await getPostgresPool().query<
    LogDiagnostic & { service: string }
  >(
    `SELECT d.message, d.frames, d.cause, d.fingerprint,
      d.redaction_count AS "redactionCount", e.service
     FROM ops.log_event_diagnostics d
     JOIN ops.log_events e ON e.event_id = d.event_id
     WHERE d.event_id = $1 AND d.expires_at > NOW()`,
    [eventId],
  );
  return result.rows[0] ?? null;
}

export async function deleteExpiredDiagnostics(): Promise<number> {
  const result = await getPostgresPool().query(
    "DELETE FROM ops.log_event_diagnostics WHERE expires_at <= NOW()",
  );
  return result.rowCount ?? 0;
}

const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export type LogVolumeBucket = {
  timestamp: string;
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
  total: number;
};

export type LogVolumeResult = {
  range: { from: string; to: string };
  bucketDurationSeconds: number;
  buckets: LogVolumeBucket[];
};

export function selectLogBucketDuration(rangeMilliseconds: number): number {
  if (rangeMilliseconds <= 60 * 60 * 1_000) return 60;
  if (rangeMilliseconds <= 6 * 60 * 60 * 1_000) return 10 * 60;
  if (rangeMilliseconds <= 24 * 60 * 60 * 1_000) return 60 * 60;
  if (rangeMilliseconds <= 7 * 24 * 60 * 60 * 1_000) return 6 * 60 * 60;
  return 24 * 60 * 60;
}

function floorUtcBucket(timestampMs: number, bucketMs: number): number {
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

export function buildLogVolumeBuckets(
  rows: Array<{
    timestamp: Date | string;
    level: string;
    count: string | number;
  }>,
  from: Date,
  to: Date,
  bucketDurationSeconds: number,
): LogVolumeBucket[] {
  const bucketMilliseconds = bucketDurationSeconds * 1_000;
  const buckets = new Map<number, LogVolumeBucket>();
  const firstBucket = floorUtcBucket(from.getTime(), bucketMilliseconds);
  const lastBucket = floorUtcBucket(to.getTime(), bucketMilliseconds);
  for (
    let timestamp = firstBucket;
    timestamp <= lastBucket;
    timestamp += bucketMilliseconds
  ) {
    buckets.set(timestamp, {
      timestamp: new Date(timestamp).toISOString(),
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
      total: 0,
    });
  }
  for (const row of rows) {
    if (!LOG_LEVELS.includes(row.level as (typeof LOG_LEVELS)[number]))
      continue;
    const timestamp = floorUtcBucket(
      new Date(row.timestamp).getTime(),
      bucketMilliseconds,
    );
    const bucket = buckets.get(timestamp);
    if (!bucket) continue;
    const count = Number(row.count);
    bucket[row.level as (typeof LOG_LEVELS)[number]] = count;
    bucket.total += count;
  }
  return [...buckets.values()];
}

export async function getLogVolume(
  query: LogsQuery,
  now = new Date(),
): Promise<LogVolumeResult> {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 24 * 60 * 60 * 1_000);
  const rangeMilliseconds = to.getTime() - from.getTime();
  const bucketDurationSeconds = selectLogBucketDuration(rangeMilliseconds);
  const filteredQuery = {
    ...query,
    from: from.toISOString(),
    to: to.toISOString(),
  };
  const { conditions, values } = buildLogWhere(filteredQuery);
  values.push(`${bucketDurationSeconds} seconds`);
  const result = await getPostgresPool().query<{
    timestamp: Date | string;
    level: string;
    count: string;
  }>(
    `
    SELECT date_bin($${values.length}::interval, occurred_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS timestamp,
      level, COUNT(*) AS count
    FROM ops.log_events
    WHERE ${conditions.join(" AND ")}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `,
    values,
  );

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    bucketDurationSeconds,
    buckets: buildLogVolumeBuckets(
      result.rows,
      from,
      to,
      bucketDurationSeconds,
    ),
  };
}

export async function getServiceSummaries(): Promise<
  Array<Record<string, unknown>>
> {
  const values = LOG_EVENT_SERVICE_DEFINITIONS.flatMap(
    ({ service, project }) => [service, project],
  );
  const registeredServicesSql = LOG_EVENT_SERVICE_DEFINITIONS.map(
    (_, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::text)`,
  ).join(", ");
  const result = await getPostgresPool().query(
    `
    WITH services(service, project) AS (VALUES ${registeredServicesSql})
    SELECT services.service, services.project,
      MAX(logs.occurred_at) AS "lastSeenAt",
      COUNT(*) FILTER (WHERE logs.level IN ('error', 'fatal') AND logs.occurred_at >= NOW() - INTERVAL '1 hour')::int AS "errorsLastHour",
      CASE
        WHEN MAX(logs.occurred_at) >= NOW() - INTERVAL '2 minutes' THEN 'healthy'
        WHEN MAX(logs.occurred_at) >= NOW() - INTERVAL '10 minutes' THEN 'stale'
        ELSE 'unknown'
      END AS status
    FROM services
    LEFT JOIN ops.log_events logs ON logs.service = services.service
    GROUP BY services.service, services.project
    ORDER BY services.project, services.service
  `,
    values,
  );
  return result.rows;
}

export async function deleteExpiredLogs(
  retentionDays: number,
): Promise<number> {
  const result = await getPostgresPool().query(
    "DELETE FROM ops.log_events WHERE occurred_at < NOW() - ($1 * INTERVAL '1 day')",
    [retentionDays],
  );
  return result.rowCount ?? 0;
}

export async function storeDeadLetter(input: {
  streamId: string;
  payloadHash: string;
  failureCode: string;
  validationIssues: unknown;
  deliveryCount: number;
}): Promise<void> {
  await getPostgresPool().query(
    `
    INSERT INTO ops.log_dead_letters
      (stream_id, payload_sha256, failure_code, validation_issues, delivery_count)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (stream_id) DO UPDATE SET
      failure_code = EXCLUDED.failure_code,
      validation_issues = EXCLUDED.validation_issues,
      delivery_count = EXCLUDED.delivery_count,
      failed_at = NOW()
  `,
    [
      input.streamId,
      input.payloadHash,
      input.failureCode,
      input.validationIssues,
      input.deliveryCount,
    ],
  );
}
