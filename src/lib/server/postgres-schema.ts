import { getPostgresPool } from "@/lib/server/postgres";

export async function ensurePostgresSchema(): Promise<void> {
  await getPostgresPool().query(`
    CREATE SCHEMA IF NOT EXISTS ops;

    CREATE TABLE IF NOT EXISTS ops.log_events (
      event_id TEXT PRIMARY KEY,
      schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
      occurred_at TIMESTAMPTZ NOT NULL,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      project TEXT NOT NULL,
      service TEXT NOT NULL,
      environment TEXT NOT NULL CHECK (environment = 'production'),
      kind TEXT NOT NULL CHECK (kind IN ('application', 'http')),
      level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'fatal')),
      message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2048),
      correlation_id TEXT,
      http_method TEXT,
      http_route TEXT,
      http_status_code INTEGER,
      http_duration_ms DOUBLE PRECISION,
      http_request_bytes BIGINT,
      http_response_bytes BIGINT,
      error_name TEXT,
      error_code TEXT,
      attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(message, '') || ' ' || coalesce(correlation_id, '') || ' ' || coalesce(http_route, ''))
      ) STORED,
      CHECK ((kind = 'http' AND http_method IS NOT NULL AND http_route IS NOT NULL AND http_status_code IS NOT NULL AND http_duration_ms IS NOT NULL) OR (kind = 'application' AND http_method IS NULL)),
      CHECK (http_status_code IS NULL OR http_status_code BETWEEN 100 AND 599),
      CHECK (http_duration_ms IS NULL OR http_duration_ms >= 0)
    );

    ALTER TABLE ops.log_events DROP CONSTRAINT IF EXISTS log_events_project_check;
    ALTER TABLE ops.log_events DROP CONSTRAINT IF EXISTS log_events_service_check;

    CREATE INDEX IF NOT EXISTS log_events_occurred_at_idx ON ops.log_events (occurred_at DESC);
    CREATE INDEX IF NOT EXISTS log_events_project_service_time_idx ON ops.log_events (project, service, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS log_events_level_time_idx ON ops.log_events (level, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS log_events_search_idx ON ops.log_events USING GIN (search_vector);

    CREATE TABLE IF NOT EXISTS ops.log_dead_letters (
      stream_id TEXT PRIMARY KEY,
      payload_sha256 TEXT NOT NULL,
      failure_code TEXT NOT NULL,
      validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
      delivery_count INTEGER NOT NULL CHECK (delivery_count >= 5),
      failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
