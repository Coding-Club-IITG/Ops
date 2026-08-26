import type { LogEventV1 } from "@contracts/log-event-v1/log-event-v1";
import { getPostgresPool } from "@/lib/server/postgres";
import type { LogsQuery } from "@/lib/server/logs/log-query";
import { LOG_EVENT_SERVICE_DEFINITIONS } from "@contracts/log-event-v1/project-registry";
import type { LogDiagnostic } from "@/lib/server/logs/log-diagnostics";

export type StoredLogEvent = LogEventV1 & {
  ingestedAt: string;
  diagnostic: {
    fingerprint: string;
    redactionCount: number;
    available: boolean;
  } | null;
};

type QueryParts = { conditions: string[]; values: unknown[] };

function addCondition(parts: QueryParts, sql: string, value: unknown): void {
  parts.values.push(value);
  parts.conditions.push(`${sql} $${parts.values.length}`);
}

function buildWhere(query: LogsQuery): QueryParts {
  const parts: QueryParts = { conditions: [], values: [] };
  if (query.from) addCondition(parts, "occurred_at >=", query.from);
  if (query.to) addCondition(parts, "occurred_at <=", query.to);
  if (query.project) addCondition(parts, "project =", query.project);
  if (query.service) addCondition(parts, "service =", query.service);
  if (query.kind) addCondition(parts, "kind =", query.kind);
  if (query.level) addCondition(parts, "level =", query.level);
  if (query.correlationId)
    addCondition(parts, "correlation_id =", query.correlationId);
  if (query.route) addCondition(parts, "http_route =", query.route);
  if (query.statusCode)
    addCondition(parts, "http_status_code =", query.statusCode);
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
  const { conditions, values } = buildWhere(query);
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
    ORDER BY ${sortColumn} ${query.order === "asc" ? "ASC" : "DESC"}, event_id DESC
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
      await client.query(
        `INSERT INTO ops.log_event_diagnostics
          (event_id, message, frames, cause, fingerprint, redaction_count)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          event.eventId,
          diagnostic.message,
          diagnostic.frames,
          diagnostic.cause ?? null,
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

export async function getLogVolume(
  hours = 24,
): Promise<Array<{ timestamp: string; level: string; count: number }>> {
  const result = await getPostgresPool().query<{
    timestamp: string;
    level: string;
    count: string;
  }>(
    `
    SELECT date_trunc('hour', occurred_at) AS timestamp, level, COUNT(*) AS count
    FROM ops.log_events
    WHERE occurred_at >= NOW() - ($1 * INTERVAL '1 hour')
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `,
    [hours],
  );
  return result.rows.map((row) => ({ ...row, count: Number(row.count) }));
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
