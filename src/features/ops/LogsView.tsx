"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import type {
  LogDiagnostic,
  LogsQuery,
  StoredLogEvent,
} from "@/types/ops.types";
import { LOG_EVENT_PROJECT_REGISTRY } from "@contracts/log-event-v1/project-registry";
import styles from "@/features/ops/ops.module.scss";

const PAGE_SIZE = 50;
const LOG_LEVEL_TONES: Record<StoredLogEvent["level"], StatusTone> = {
  debug: "neutral",
  info: "info",
  warn: "warning",
  error: "danger",
  fatal: "danger",
};
const IST_DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatIstTimestamp(timestamp: string): string {
  return IST_DATE_TIME_FORMAT.format(new Date(timestamp));
}

export function LogsView() {
  const [query, setQuery] = useState<LogsQuery>({
    limit: PAGE_SIZE,
    offset: 0,
    order: "desc",
  });
  const [data, setData] = useState<StoredLogEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{
    eventId: string;
    data: LogDiagnostic;
  } | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const response = (await apiFetch(
        "/logs",
        {},
        query as Record<string, unknown>,
      )) as {
        data: StoredLogEvent[];
        total: number;
        operatorRole: "viewer" | "admin";
      };
      setData(response.data);
      setTotal(response.total);
      setIsAdmin(response.operatorRole === "admin");
      setError(null);
    } catch (cause) {
      console.error(cause);
      setError("Logs are temporarily unavailable");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const viewDiagnostic = useCallback(async (eventId: string) => {
    setDiagnosticLoading(eventId);
    try {
      const response = (await apiFetch(
        `/logs/${encodeURIComponent(eventId)}/diagnostics`,
      )) as { data: LogDiagnostic };
      setDiagnostic({ eventId, data: response.data });
    } catch {
      setError("Diagnostics are unavailable or have expired");
    } finally {
      setDiagnosticLoading(null);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const stream = new EventSource("/api/logs/stream");
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    stream.addEventListener("ready", () => setLive(true));
    stream.addEventListener("log", () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(), 250);
    });
    stream.onerror = () => setLive(false);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      stream.close();
    };
  }, [refresh]);

  const setFilter = <K extends keyof LogsQuery>(
    key: K,
    value: LogsQuery[K],
  ) => {
    setQuery((current) => ({
      ...current,
      [key]: value || undefined,
      offset: 0,
    }));
  };
  const page = Math.floor((query.offset ?? 0) / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && key !== "limit" && key !== "offset")
        params.set(key, String(value));
    });
    return `/api/logs/export?${params}`;
  }, [query]);
  const serviceOptions = useMemo(
    () =>
      LOG_EVENT_PROJECT_REGISTRY.filter(
        (project) => !query.project || project.id === query.project,
      ).flatMap((project) =>
        project.services.map((service) => ({
          id: service.id,
          label: `${project.name} · ${service.name}`,
        })),
      ),
    [query.project],
  );

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Safe fields · LogEventV1</p>
          <h1 className={styles.heading}>Production logs</h1>
          <p className={styles.subheading}>
            Route templates and allowlisted operational fields only. Request
            bodies, credentials, identity data, and raw URLs are never captured.
          </p>
        </div>
        <div className={styles.headerActions}>
          <StatusBadge tone={live ? "success" : "warning"} live="polite">
            {live ? "Live" : "Reconnecting"}
          </StatusBadge>
          <a className={styles.button} href={exportUrl}>
            <Download aria-hidden="true" size={15} />
            Export CSV
          </a>
        </div>
      </div>

      <section className={`${styles.panel} ${styles.panelWide}`}>
        <div className={styles.panelBody}>
          <div className={styles.toolbar}>
            <input
              className={styles.input}
              aria-label="Search logs"
              placeholder="Search safe message, route, or correlation ID"
              value={query.q ?? ""}
              onChange={(event) => setFilter("q", event.target.value)}
            />
            <select
              className={styles.select}
              aria-label="Project"
              value={query.project ?? ""}
              onChange={(event) => {
                const project = event.target.value as LogsQuery["project"];
                setQuery((current) => ({
                  ...current,
                  project: project || undefined,
                  service: undefined,
                  offset: 0,
                }));
              }}
            >
              <option value="">All projects</option>
              {LOG_EVENT_PROJECT_REGISTRY.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              aria-label="Service"
              value={query.service ?? ""}
              onChange={(event) =>
                setFilter("service", event.target.value as LogsQuery["service"])
              }
            >
              <option value="">All services</option>
              {serviceOptions.map((service) => (
                <option value={service.id} key={service.id}>
                  {service.label}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              aria-label="Kind"
              value={query.kind ?? ""}
              onChange={(event) =>
                setFilter("kind", event.target.value as LogsQuery["kind"])
              }
            >
              <option value="">All kinds</option>
              <option value="application">Application</option>
              <option value="http">HTTP</option>
            </select>
            <select
              className={styles.select}
              aria-label="Level"
              value={query.level ?? ""}
              onChange={(event) =>
                setFilter("level", event.target.value as LogsQuery["level"])
              }
            >
              <option value="">All levels</option>
              {["debug", "info", "warn", "error", "fatal"].map((level) => (
                <option value={level} key={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  <th>Service</th>
                  <th>Level</th>
                  <th>Message</th>
                  <th>HTTP</th>
                  <th>Correlation</th>
                </tr>
              </thead>
              <tbody>
                {data.map((log) => (
                  <LogRow
                    log={log}
                    isAdmin={isAdmin}
                    diagnostic={
                      diagnostic?.eventId === log.eventId
                        ? diagnostic.data
                        : null
                    }
                    loading={diagnosticLoading === log.eventId}
                    onView={() => void viewDiagnostic(log.eventId)}
                    key={log.eventId}
                  />
                ))}
              </tbody>
            </table>
            {!loading && data.length === 0 && (
              <div className={styles.empty}>No events match these filters.</div>
            )}
            {loading && (
              <div className={styles.empty}>Loading production events…</div>
            )}
          </div>
          <div className={styles.pagination}>
            <span className={styles.muted}>
              {total.toLocaleString()} events · page {page} of {pages}
            </span>
            <button
              className={styles.secondaryButton}
              disabled={page <= 1}
              onClick={() =>
                setQuery((current) => ({
                  ...current,
                  offset: Math.max(0, (current.offset ?? 0) - PAGE_SIZE),
                }))
              }
            >
              Previous
            </button>
            <button
              className={styles.secondaryButton}
              disabled={page >= pages}
              onClick={() =>
                setQuery((current) => ({
                  ...current,
                  offset: (current.offset ?? 0) + PAGE_SIZE,
                }))
              }
            >
              Next
            </button>
            <button
              className={styles.secondaryButton}
              aria-label="Refresh logs"
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function LogRow({
  log,
  isAdmin,
  diagnostic,
  loading,
  onView,
}: {
  log: StoredLogEvent;
  isAdmin: boolean;
  diagnostic: LogDiagnostic | null;
  loading: boolean;
  onView: () => void;
}) {
  return (
    <tr>
      <td className={styles.mono}>
        <time dateTime={log.timestamp} title={log.timestamp}>
          {formatIstTimestamp(log.timestamp)}
        </time>
      </td>
      <td>
        <strong>{log.service}</strong>
        <div className={styles.muted}>
          {log.project} · {log.kind}
        </div>
      </td>
      <td>
        <StatusBadge tone={LOG_LEVEL_TONES[log.level]}>{log.level}</StatusBadge>
      </td>
      <td className={styles.message}>
        {log.message}
        {log.error && (
          <div className={`${styles.muted} ${styles.mono}`}>
            {[log.error.name, log.error.code].filter(Boolean).join(" · ")}
          </div>
        )}
        {log.diagnostic && (
          <div className={styles.diagnosticSummary}>
            <span className={styles.mono}>
              Fingerprint {log.diagnostic.fingerprint.slice(0, 12)}
            </span>
            <span>
              {log.diagnostic.redactionCount} redaction
              {log.diagnostic.redactionCount === 1 ? "" : "s"}
            </span>
            {isAdmin && log.diagnostic.available && (
              <button
                className={styles.secondaryButton}
                disabled={loading}
                onClick={onView}
              >
                <ShieldCheck size={14} />{" "}
                {loading ? "Loading…" : "View diagnostics"}
              </button>
            )}
          </div>
        )}
        {diagnostic && <DiagnosticDetails diagnostic={diagnostic} />}
      </td>
      <td className={styles.mono}>
        {log.http ? (
          <>
            {log.http.method} {log.http.route}
            <div className={styles.muted}>
              {log.http.statusCode} · {log.http.durationMs.toFixed(1)} ms
            </div>
          </>
        ) : (
          "-"
        )}
      </td>
      <td className={styles.mono}>{log.correlationId ?? "-"}</td>
    </tr>
  );
}

function DiagnosticDetails({ diagnostic }: { diagnostic: LogDiagnostic }) {
  return (
    <section
      className={styles.diagnosticDetails}
      aria-label="Sanitized error diagnostics"
    >
      <strong>Sanitized diagnostics</strong>
      <p>{diagnostic.message}</p>
      <FrameList frames={diagnostic.frames} />
      {diagnostic.cause && <CauseDetails cause={diagnostic.cause} />}
      <p className={styles.redactionNotice}>
        Sensitive values are permanently unavailable.{" "}
        {diagnostic.redactionCount} value
        {diagnostic.redactionCount === 1 ? " was" : "s were"} redacted before
        ingestion.
      </p>
    </section>
  );
}

function FrameList({ frames }: { frames: LogDiagnostic["frames"] }) {
  if (!frames.length)
    return <p className={styles.muted}>No recognized Node/V8 frames.</p>;
  return (
    <ol className={`${styles.trace} ${styles.mono}`}>
      {frames.map((frame, index) => (
        <li key={`${frame.file}:${frame.line}:${frame.column}:${index}`}>
          {frame.function ? `${frame.function} · ` : ""}
          {frame.file}:{frame.line}:{frame.column}
        </li>
      ))}
    </ol>
  );
}

function CauseDetails({
  cause,
}: {
  cause: NonNullable<LogDiagnostic["cause"]>;
}) {
  return (
    <div className={styles.cause}>
      <strong>
        Caused by {cause.name ?? "Error"}
        {cause.code ? ` · ${cause.code}` : ""}
      </strong>
      <p>{cause.message}</p>
      <FrameList frames={cause.frames} />
      {cause.cause && <CauseDetails cause={cause.cause} />}
    </div>
  );
}
