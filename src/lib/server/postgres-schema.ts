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
      diagnostic_fingerprint TEXT,
      diagnostic_redaction_count INTEGER NOT NULL DEFAULT 0,
      diagnostic_available BOOLEAN NOT NULL DEFAULT FALSE,
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

    ALTER TABLE ops.log_events ADD COLUMN IF NOT EXISTS diagnostic_fingerprint TEXT;
    ALTER TABLE ops.log_events ADD COLUMN IF NOT EXISTS diagnostic_redaction_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ops.log_events ADD COLUMN IF NOT EXISTS diagnostic_available BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS ops.log_event_diagnostics (
      event_id TEXT PRIMARY KEY REFERENCES ops.log_events(event_id) ON DELETE CASCADE,
      message TEXT NOT NULL CHECK (char_length(message) <= 2048),
      frames JSONB NOT NULL DEFAULT '[]'::jsonb,
      cause JSONB,
      fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      redaction_count INTEGER NOT NULL CHECK (redaction_count >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
    );
    CREATE INDEX IF NOT EXISTS log_event_diagnostics_expiry_idx ON ops.log_event_diagnostics (expires_at);

    CREATE TABLE IF NOT EXISTS ops.log_dead_letters (
      stream_id TEXT PRIMARY KEY,
      payload_sha256 TEXT NOT NULL,
      failure_code TEXT NOT NULL,
      validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
      delivery_count INTEGER NOT NULL CHECK (delivery_count >= 5),
      failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ops.alert_rules (
      rule_key TEXT NOT NULL,
      target TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
      threshold DOUBLE PRECISION NOT NULL CHECK (threshold >= 0),
      window_seconds INTEGER NOT NULL CHECK (window_seconds >= 30),
      for_seconds INTEGER NOT NULL CHECK (for_seconds >= 30),
      reminder_seconds INTEGER NOT NULL CHECK (reminder_seconds >= 300),
      minimum_count INTEGER NOT NULL DEFAULT 0 CHECK (minimum_count >= 0),
      updated_by TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (rule_key, target)
    );

    CREATE TABLE IF NOT EXISTS ops.alert_instances (
      id TEXT PRIMARY KEY,
      rule_key TEXT NOT NULL,
      target TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'firing', 'resolved')),
      summary TEXT NOT NULL,
      value DOUBLE PRECISION,
      threshold DOUBLE PRECISION,
      pending_since TIMESTAMPTZ NOT NULL,
      fired_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      resolution_reason TEXT,
      last_evaluated_at TIMESTAMPTZ NOT NULL,
      last_notification_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS alert_instances_active_unique
      ON ops.alert_instances (rule_key, target) WHERE status IN ('pending', 'firing');
    CREATE INDEX IF NOT EXISTS alert_instances_status_updated_idx
      ON ops.alert_instances (status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ops.alert_transitions (
      id BIGSERIAL PRIMARY KEY,
      alert_id TEXT NOT NULL REFERENCES ops.alert_instances(id) ON DELETE CASCADE,
      transition TEXT NOT NULL,
      reason TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS alert_transitions_alert_time_idx
      ON ops.alert_transitions (alert_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS ops.alert_mutes (
      target TEXT PRIMARY KEY,
      reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
      muted_by TEXT NOT NULL,
      muted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS ops.alert_notifications (
      id TEXT PRIMARY KEY,
      alert_id TEXT NOT NULL REFERENCES ops.alert_instances(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('firing', 'reminder', 'recovery')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'suppressed')) DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      discord_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivered_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS alert_notifications_delivery_idx
      ON ops.alert_notifications (status, next_attempt_at);
  `);
}
