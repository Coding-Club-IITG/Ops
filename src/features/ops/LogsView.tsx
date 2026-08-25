"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { LogsQuery, StoredLogEvent } from "@/types/ops.types";
import { LOG_EVENT_PROJECT_REGISTRY } from "@contracts/log-event-v1/project-registry";
import styles from "@/features/ops/ops.module.scss";

const PAGE_SIZE = 50;

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

  const refresh = useCallback(async () => {
    try {
      const response = (await apiFetch(
        "/logs",
        {},
        query as Record<string, unknown>,
      )) as { data: StoredLogEvent[]; total: number };
      setData(response.data);
      setTotal(response.total);
      setError(null);
    } catch (cause) {
      console.error(cause);
      setError("Logs are temporarily unavailable");
    } finally {
      setLoading(false);
    }
  }, [query]);

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
        <div>
          <span
            className={live ? styles.live : styles.offline}
            aria-live="polite"
          >
            ● {live ? "Live" : "Reconnecting"}
          </span>{" "}
          <a className={styles.button} href={exportUrl}>
            <Download size={15} />
            &nbsp; Export CSV
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
                  <th>Time</th>
                  <th>Service</th>
                  <th>Level</th>
                  <th>Message</th>
                  <th>HTTP</th>
                  <th>Correlation</th>
                </tr>
              </thead>
              <tbody>
                {data.map((log) => (
                  <LogRow log={log} key={log.eventId} />
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
              className={styles.button}
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
              className={styles.button}
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
              className={styles.button}
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

function LogRow({ log }: { log: StoredLogEvent }) {
  return (
    <tr>
      <td className={styles.mono}>
        {new Date(log.timestamp).toLocaleString()}
      </td>
      <td>
        <strong>{log.service}</strong>
        <div className={styles.muted}>
          {log.project} · {log.kind}
        </div>
      </td>
      <td>
        <span
          className={`${styles.status} ${log.level === "error" || log.level === "fatal" ? styles.error : ""}`}
        >
          {log.level}
        </span>
      </td>
      <td className={styles.message}>
        {log.message}
        {log.error && (
          <div className={`${styles.muted} ${styles.mono}`}>
            {[log.error.name, log.error.code].filter(Boolean).join(" · ")}
          </div>
        )}
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
