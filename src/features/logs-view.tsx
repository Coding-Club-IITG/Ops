"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Download,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { ChartTooltip } from "@/components/ChartTooltip";
import type {
  LogDiagnostic,
  CorrelationTimelineResponse,
  LogsQuery,
  LogView,
  LogViewColumn,
  LogVolumeResponse,
  StoredLogEvent,
} from "@/types/ops.types";
import {
  LOG_EVENT_ATTRIBUTE_KEYS,
  LOG_EVENT_LEVELS,
} from "@contracts/log-event-v1/log-event-v1";
import { LOG_EVENT_PROJECT_REGISTRY } from "@contracts/log-event-v1/project-registry";
import {
  CORRELATION_TIMELINE_LIMIT,
  DEFAULT_LOGS_RANGE,
  DEFAULT_PAGE_SIZE,
  LOG_LEVEL_CHART_COLORS,
  OPS_RANGES,
  OPS_RANGE_MILLISECONDS,
  type OpsRange,
  isOpsRange,
} from "@/lib/ops-constants";
import {
  formatIndianNumber,
  formatIst,
  formatIstInput,
  parseIstInput,
} from "@/lib/formatters";
import styles from "@/features/ops.module.scss";

type RelativeRange = OpsRange;
const DEFAULT_COLUMNS: LogViewColumn[] = [
  "timestamp",
  "projectService",
  "level",
  "message",
  "method",
  "route",
  "statusCode",
  "durationMs",
  "correlationId",
];
const BASE_COLUMNS: Array<{ id: LogViewColumn; label: string }> = [
  { id: "timestamp", label: "Time (IST)" },
  { id: "projectService", label: "Project / service" },
  { id: "kind", label: "Kind" },
  { id: "level", label: "Level" },
  { id: "message", label: "Message" },
  { id: "method", label: "Method" },
  { id: "route", label: "Route" },
  { id: "statusCode", label: "Status" },
  { id: "durationMs", label: "Duration" },
  { id: "correlationId", label: "Correlation ID" },
  { id: "error", label: "Error" },
];
const COLUMN_OPTIONS: Array<{ id: LogViewColumn; label: string }> = [
  ...BASE_COLUMNS,
  ...LOG_EVENT_ATTRIBUTE_KEYS.map((key) => ({
    id: `attribute:${key}` as LogViewColumn,
    label: `Attribute · ${key}`,
  })),
];
const LEVEL_TONES: Record<StoredLogEvent["level"], StatusTone> = {
  debug: "neutral",
  info: "info",
  warn: "warning",
  error: "danger",
  fatal: "danger",
};
function numberParam(params: URLSearchParams, key: string): number | undefined {
  const value = params.get(key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function queryFromParams(params: URLSearchParams): LogsQuery {
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    eventId: params.get("eventId") ?? undefined,
    project: (params.get("project") as LogsQuery["project"]) || undefined,
    service: (params.get("service") as LogsQuery["service"]) || undefined,
    kind: (params.get("kind") as LogsQuery["kind"]) || undefined,
    level: (params.get("level") as LogsQuery["level"]) || undefined,
    correlationId: params.get("correlationId") ?? undefined,
    method: params.get("method") ?? undefined,
    route: params.get("route") ?? undefined,
    statusCode: numberParam(params, "statusCode"),
    statusClass:
      (params.get("statusClass") as LogsQuery["statusClass"]) || undefined,
    durationMin: numberParam(params, "durationMin"),
    durationMax: numberParam(params, "durationMax"),
    q: params.get("q") ?? undefined,
    limit: DEFAULT_PAGE_SIZE,
    offset: numberParam(params, "offset") ?? 0,
    sort: params.get("sort") === "durationMs" ? "durationMs" : "timestamp",
    order: params.get("order") === "asc" ? "asc" : "desc",
  };
}
function activeQuery(params: URLSearchParams): LogsQuery {
  const query = queryFromParams(params);
  const range = params.get("range") ?? DEFAULT_LOGS_RANGE;
  if (!isOpsRange(range)) return query;
  const to = new Date();
  return {
    ...query,
    from: new Date(to.getTime() - OPS_RANGE_MILLISECONDS[range]).toISOString(),
    to: to.toISOString(),
  };
}
function columnsFromParams(params: URLSearchParams): LogViewColumn[] {
  const allowed = new Set(COLUMN_OPTIONS.map((column) => column.id));
  const columns = (params.get("columns")?.split(",") ?? []).filter(
    (column): column is LogViewColumn => allowed.has(column as LogViewColumn),
  );
  return columns.length ? columns : DEFAULT_COLUMNS;
}

export function LogsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);
  const query = useMemo(() => activeQuery(params), [params]);
  const visibleColumns = useMemo(() => columnsFromParams(params), [params]);
  const [searchText, setSearchText] = useState(params.get("q") ?? "");
  const [events, setEvents] = useState<StoredLogEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [volume, setVolume] = useState<LogVolumeResponse | null>(null);
  const [views, setViews] = useState<LogView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selected, setSelected] = useState<StoredLogEvent | null>(null);
  const [diagnostic, setDiagnostic] = useState<LogDiagnostic | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replaceParams = useCallback(
    (next: URLSearchParams) =>
      router.replace(`${pathname}?${next.toString()}`, { scroll: false }),
    [pathname, router],
  );
  const updateParams = useCallback(
    (
      updates: Record<string, string | number | undefined>,
      resetPage = true,
    ) => {
      const next = new URLSearchParams(paramsKey);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, String(value));
      });
      if (resetPage) next.delete("offset");
      replaceParams(next);
    },
    [paramsKey, replaceParams],
  );

  useEffect(() => {
    if (!searchParams.has("range") && !searchParams.has("from")) {
      const next = new URLSearchParams(searchParams.toString());
      next.set("range", DEFAULT_LOGS_RANGE);
      replaceParams(next);
    }
  }, [replaceParams, searchParams]);
  useEffect(() => setSearchText(params.get("q") ?? ""), [params]);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const apiQuery = query as Record<string, unknown>;
      const [logs, chart] = await Promise.all([
        apiFetch("/logs", {}, apiQuery) as Promise<{
          data: StoredLogEvent[];
          total: number;
          operatorRole: "viewer" | "admin";
        }>,
        apiFetch("/logs/volume", {}, apiQuery) as Promise<LogVolumeResponse>,
      ]);
      setEvents(logs.data);
      setTotal(logs.total);
      setIsAdmin(logs.operatorRole === "admin");
      setVolume(chart);
      setError(null);
    } catch (cause) {
      console.error(cause);
      setError("Logs are temporarily unavailable");
    } finally {
      setLoading(false);
    }
  }, [query]);
  const loadViews = useCallback(async () => {
    try {
      setViews(((await apiFetch("/log-views")) as { data: LogView[] }).data);
    } catch {
      setError("Saved log views are temporarily unavailable");
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    void loadViews();
  }, [loadViews]);
  useEffect(() => {
    const stream = new EventSource("/api/logs/stream");
    let timer: ReturnType<typeof setTimeout> | undefined;
    stream.addEventListener("ready", () => setLive(true));
    stream.addEventListener("log", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    });
    stream.onerror = () => setLive(false);
    return () => {
      if (timer) clearTimeout(timer);
      stream.close();
    };
  }, [refresh]);

  const updateSearch = (value: string) => {
    setSearchText(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => updateParams({ q: value || undefined }),
      300,
    );
  };
  const setRange = (range: string) => {
    if (range !== "custom")
      return updateParams({ range, from: undefined, to: undefined });
    const to = new Date();
    updateParams({
      range: "custom",
      from: new Date(
        to.getTime() - OPS_RANGE_MILLISECONDS[DEFAULT_LOGS_RANGE],
      ).toISOString(),
      to: to.toISOString(),
    });
  };
  const resetAll = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchText("");
    replaceParams(new URLSearchParams({ range: DEFAULT_LOGS_RANGE }));
  };
  const applyView = (id: string) => {
    const view = views.find((candidate) => candidate.id === id);
    if (!view) return;
    const next = new URLSearchParams({
      range: view.relativeTime,
      view: view.id,
      sort: view.sort.field,
      order: view.sort.order,
      columns: view.visibleColumns.join(","),
    });
    Object.entries(view.filters).forEach(([key, value]) => {
      if (value !== undefined) next.set(key, String(value));
    });
    replaceParams(next);
  };
  const currentViewInput = (name: string, description?: string) => ({
    name,
    description: description || undefined,
    relativeTime: params.get("range") as RelativeRange,
    filters: Object.fromEntries(
      Object.entries(queryFromParams(params)).filter(
        ([key, value]) =>
          value !== undefined &&
          !["from", "to", "limit", "offset", "sort", "order"].includes(key),
      ),
    ),
    sort: { field: query.sort ?? "timestamp", order: query.order ?? "desc" },
    visibleColumns,
  });
  const createView = async () => {
    const name = window.prompt("Name this team log view");
    if (!name) return;
    try {
      const response = (await apiFetch("/log-views", {
        method: "POST",
        body: JSON.stringify(
          currentViewInput(
            name,
            window.prompt("Optional description") ?? undefined,
          ),
        ),
      })) as { data: LogView };
      await loadViews();
      updateParams({ view: response.data.id }, false);
    } catch {
      setError(
        "The saved view could not be created. Its name may already exist.",
      );
    }
  };
  const updateView = async () => {
    const view = views.find((candidate) => candidate.id === params.get("view"));
    if (!view) return;
    try {
      await apiFetch(`/log-views/${encodeURIComponent(view.id)}`, {
        method: "PATCH",
        body: JSON.stringify(currentViewInput(view.name, view.description)),
      });
      await loadViews();
    } catch {
      setError("The saved view could not be updated.");
    }
  };
  const deleteView = async () => {
    const view = views.find((candidate) => candidate.id === params.get("view"));
    if (!view || !window.confirm(`Delete “${view.name}”?`)) return;
    try {
      await apiFetch(`/log-views/${encodeURIComponent(view.id)}`, {
        method: "DELETE",
      });
      updateParams({ view: undefined }, false);
      await loadViews();
    } catch {
      setError("The saved view could not be deleted.");
    }
  };
  const viewDiagnostic = async () => {
    if (!selected) return;
    setDiagnosticLoading(true);
    try {
      setDiagnostic(
        (
          (await apiFetch(
            `/logs/${encodeURIComponent(selected.eventId)}/diagnostics`,
          )) as { data: LogDiagnostic }
        ).data,
      );
    } catch {
      setError("Diagnostics are unavailable or have expired");
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const range = params.get("range") ?? DEFAULT_LOGS_RANGE;
  const page = Math.floor((query.offset ?? 0) / DEFAULT_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const exportUrl = useMemo(() => {
    const exportParams = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && key !== "limit" && key !== "offset")
        exportParams.set(key, String(value));
    });
    return `/api/logs/export?${exportParams}`;
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
          <p className={styles.eyebrow}>LogEventV1</p>
          <h1 className={styles.heading}>Production logs</h1>
          <p className={styles.subheading}>
            Shareable investigations over stored, allow-listed operational
            fields.
          </p>
        </div>
        <div className={styles.headerActions}>
          <StatusBadge tone={live ? "success" : "warning"} live="polite">
            {live ? "Live" : "Reconnecting"}
          </StatusBadge>
          <a className={styles.button} href={exportUrl}>
            <Download size={15} /> Export CSV
          </a>
        </div>
      </div>
      <section className={`${styles.panel} ${styles.panelWide}`}>
        <div className={styles.panelBody}>
          <div className={styles.savedViewBar}>
            <label className={styles.fieldLabel}>
              Team saved view
              <select
                className={styles.select}
                value={params.get("view") ?? ""}
                onChange={(event) => applyView(event.target.value)}
              >
                <option value="">Current investigation</option>
                {views.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.inlineActions}>
              <button className={styles.secondaryButton} onClick={resetAll}>
                <RotateCcw size={14} /> Reset all
              </button>
              {isAdmin && (
                <>
                  <button
                    className={styles.secondaryButton}
                    disabled={range === "custom"}
                    onClick={() => void createView()}
                  >
                    Save as new
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={range === "custom" || !params.get("view")}
                    onClick={() => void updateView()}
                  >
                    Update view
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={!params.get("view")}
                    onClick={() => void deleteView()}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
          <div className={styles.toolbar}>
            <input
              className={styles.input}
              aria-label="Search logs"
              placeholder="Search message, route, or correlation ID"
              value={searchText}
              onChange={(event) => updateSearch(event.target.value)}
            />
            <select
              className={styles.select}
              aria-label="Time range"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              {OPS_RANGES.map((option) => (
                <option key={option} value={option}>
                  Last {option}
                </option>
              ))}
              <option value="custom">Custom range</option>
            </select>
            <select
              className={styles.select}
              aria-label="Project"
              value={query.project ?? ""}
              onChange={(event) =>
                updateParams({
                  project: event.target.value || undefined,
                  service: undefined,
                })
              }
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
                updateParams({ service: event.target.value || undefined })
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
              aria-label="Level"
              value={query.level ?? ""}
              onChange={(event) =>
                updateParams({ level: event.target.value || undefined })
              }
            >
              <option value="">All levels</option>
              {LOG_EVENT_LEVELS.map((level) => (
                <option value={level} key={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
          {range === "custom" && (
            <div className={styles.customRange}>
              <label className={styles.fieldLabel}>
                From (IST)
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={formatIstInput(query.from)}
                  onChange={(event) =>
                    updateParams({ from: parseIstInput(event.target.value) })
                  }
                />
              </label>
              <label className={styles.fieldLabel}>
                To (IST)
                <input
                  className={styles.input}
                  type="datetime-local"
                  value={formatIstInput(query.to)}
                  onChange={(event) =>
                    updateParams({ to: parseIstInput(event.target.value) })
                  }
                />
              </label>
            </div>
          )}
          <details className={styles.advancedFilters}>
            <summary>
              <Settings2 size={15} /> Advanced filters and columns
            </summary>
            <div className={styles.advancedGrid}>
              <FilterInput
                label="Event ID"
                value={query.eventId}
                onChange={(value) => updateParams({ eventId: value })}
              />
              <FilterInput
                label="Correlation ID"
                value={query.correlationId}
                onChange={(value) => updateParams({ correlationId: value })}
              />
              <FilterInput
                label="Route template"
                value={query.route}
                onChange={(value) => updateParams({ route: value })}
              />
              <FilterInput
                label="HTTP method"
                value={query.method}
                onChange={(value) =>
                  updateParams({ method: value?.toUpperCase() })
                }
              />
              <label className={styles.fieldLabel}>
                Kind
                <select
                  className={styles.select}
                  value={query.kind ?? ""}
                  onChange={(event) =>
                    updateParams({ kind: event.target.value || undefined })
                  }
                >
                  <option value="">All kinds</option>
                  <option value="application">Application</option>
                  <option value="http">HTTP</option>
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Status class
                <select
                  className={styles.select}
                  value={query.statusClass ?? ""}
                  onChange={(event) =>
                    updateParams({
                      statusClass: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Any class</option>
                  {["1xx", "2xx", "3xx", "4xx", "5xx"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <FilterInput
                label="Exact status"
                type="number"
                value={query.statusCode}
                onChange={(value) => updateParams({ statusCode: value })}
              />
              <FilterInput
                label="Minimum duration (ms)"
                type="number"
                value={query.durationMin}
                onChange={(value) => updateParams({ durationMin: value })}
              />
              <FilterInput
                label="Maximum duration (ms)"
                type="number"
                value={query.durationMax}
                onChange={(value) => updateParams({ durationMax: value })}
              />
              <label className={styles.fieldLabel}>
                Sort field
                <select
                  className={styles.select}
                  value={query.sort}
                  onChange={(event) =>
                    updateParams({ sort: event.target.value })
                  }
                >
                  <option value="timestamp">Timestamp</option>
                  <option value="durationMs">Duration</option>
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Sort order
                <select
                  className={styles.select}
                  value={query.order}
                  onChange={(event) =>
                    updateParams({ order: event.target.value })
                  }
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </label>
            </div>
            <fieldset className={styles.columnPicker}>
              <legend>Visible columns</legend>
              {COLUMN_OPTIONS.map((column) => (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={visibleColumns.includes(column.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...visibleColumns, column.id]
                        : visibleColumns.filter((id) => id !== column.id);
                      if (next.length)
                        updateParams({ columns: next.join(",") }, false);
                    }}
                  />{" "}
                  {column.label}
                </label>
              ))}
            </fieldset>
          </details>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <VolumeChart volume={volume} />
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {visibleColumns.map((column) => (
                    <th key={column}>
                      {
                        COLUMN_OPTIONS.find((option) => option.id === column)
                          ?.label
                      }
                    </th>
                  ))}
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((log) => (
                  <tr key={log.eventId}>
                    {visibleColumns.map((column) => (
                      <td key={column}>{renderCell(log, column)}</td>
                    ))}
                    <td>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => {
                          setSelected(log);
                          setDiagnostic(null);
                        }}
                      >
                        View event
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && events.length === 0 && (
              <div className={styles.empty}>No events match these filters.</div>
            )}
            {loading && (
              <div className={styles.empty}>Loading production events…</div>
            )}
          </div>
          <div className={styles.pagination}>
            <span className={styles.muted}>
              {formatIndianNumber(total)} events · page {page} of {pages}
            </span>
            <button
              className={styles.secondaryButton}
              disabled={page <= 1}
              onClick={() =>
                updateParams(
                  {
                    offset: Math.max(
                      0,
                      (query.offset ?? 0) - DEFAULT_PAGE_SIZE,
                    ),
                  },
                  false,
                )
              }
            >
              Previous
            </button>
            <button
              className={styles.secondaryButton}
              disabled={page >= pages}
              onClick={() =>
                updateParams(
                  { offset: (query.offset ?? 0) + DEFAULT_PAGE_SIZE },
                  false,
                )
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
      {selected && (
        <EventDrawer
          event={selected}
          diagnostic={diagnostic}
          diagnosticLoading={diagnosticLoading}
          isAdmin={isAdmin}
          onDiagnostic={() => void viewDiagnostic()}
          onClose={() => {
            setSelected(null);
            setDiagnostic(null);
          }}
        />
      )}
    </main>
  );
}

function FilterInput({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value?: string | number;
  type?: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className={styles.fieldLabel}>
      {label}
      <input
        className={styles.input}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </label>
  );
}
function renderCell(log: StoredLogEvent, column: LogViewColumn) {
  if (column.startsWith("attribute:")) {
    const key = column.slice(10) as keyof NonNullable<
      StoredLogEvent["attributes"]
    >;
    return (
      <span className={styles.mono}>
        {String(log.attributes?.[key] ?? "-")}
      </span>
    );
  }
  switch (column) {
    case "timestamp":
      return (
        <time
          className={styles.mono}
          dateTime={log.timestamp}
          title={log.timestamp}
        >
          {formatIst(log.timestamp)}
        </time>
      );
    case "projectService":
      return (
        <>
          <strong>{log.service}</strong>
          <div className={styles.muted}>{log.project}</div>
        </>
      );
    case "kind":
      return log.kind;
    case "level":
      return (
        <StatusBadge tone={LEVEL_TONES[log.level]}>{log.level}</StatusBadge>
      );
    case "message":
      return <span className={styles.message}>{log.message}</span>;
    case "method":
      return <span className={styles.mono}>{log.http?.method ?? "-"}</span>;
    case "route":
      return <span className={styles.mono}>{log.http?.route ?? "-"}</span>;
    case "statusCode":
      return <span className={styles.mono}>{log.http?.statusCode ?? "-"}</span>;
    case "durationMs":
      return (
        <span className={styles.mono}>
          {log.http ? `${log.http.durationMs.toFixed(1)} ms` : "-"}
        </span>
      );
    case "correlationId":
      return <span className={styles.mono}>{log.correlationId ?? "-"}</span>;
    case "error":
      return (
        <span className={styles.mono}>
          {log.error
            ? [log.error.name, log.error.code].filter(Boolean).join(" · ")
            : "-"}
        </span>
      );
  }
}
function VolumeChart({ volume }: { volume: LogVolumeResponse | null }) {
  const summary = volume
    ? `${volume.buckets.reduce((sum, bucket) => sum + bucket.total, 0)} events across ${volume.buckets.length} buckets.`
    : "Log volume is loading.";
  return (
    <section className={styles.volumePanel} aria-label="Filtered log volume">
      <div className={styles.panelHeader}>
        <h2>Filtered log volume</h2>
        <span className={styles.muted}>{summary}</span>
      </div>
      <div className={styles.chart}>
        {volume?.buckets.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={volume.buckets}
              margin={{ top: 12, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                minTickGap={28}
                tickFormatter={(value) => formatIst(String(value))}
              />
              <YAxis allowDecimals={false} width={42} />
              <Tooltip
                cursor={false}
                content={(props) => (
                  <ChartTooltip
                    {...props}
                    formatLabel={(value) => formatIst(String(value))}
                    formatValue={(value) =>
                      `${formatIndianNumber(Number(value))} events`
                    }
                  />
                )}
              />
              <Legend />
              {LOG_EVENT_LEVELS.map((level) => (
                <Bar
                  key={level}
                  dataKey={level}
                  stackId="logs"
                  fill={LOG_LEVEL_CHART_COLORS[level]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.empty}>No log volume to display.</div>
        )}
      </div>
      <p className={styles.srOnly}>{summary} Times are shown in IST.</p>
    </section>
  );
}
function EventDrawer({
  event,
  diagnostic,
  diagnosticLoading,
  isAdmin,
  onDiagnostic,
  onClose,
}: {
  event: StoredLogEvent;
  diagnostic: LogDiagnostic | null;
  diagnosticLoading: boolean;
  isAdmin: boolean;
  onDiagnostic: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"detail" | "timeline">("detail");
  const [timeline, setTimeline] = useState<CorrelationTimelineResponse | null>(
    null,
  );
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  useEffect(() => {
    setTab("detail");
    setTimeline(null);
    setTimelineError(null);
  }, [event.eventId]);

  const showTimeline = async () => {
    setTab("timeline");
    if (!event.correlationId || timeline || timelineLoading) return;
    setTimelineLoading(true);
    try {
      setTimeline(
        (await apiFetch(
          `/logs/correlation/${encodeURIComponent(event.correlationId)}`,
        )) as CorrelationTimelineResponse,
      );
      setTimelineError(null);
    } catch {
      setTimelineError("The retained correlation timeline is unavailable.");
    } finally {
      setTimelineLoading(false);
    }
  };
  return (
    <div
      className={styles.drawerBackdrop}
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose();
      }}
    >
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-title"
      >
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.eyebrow}>Stored LogEventV1 fields</p>
            <h2 id="event-title">Event detail</h2>
          </div>
          <button
            className={styles.secondaryButton}
            aria-label="Close event detail"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        {event.correlationId && (
          <div
            className={styles.drawerTabs}
            role="tablist"
            aria-label="Event views"
          >
            <button
              className={tab === "detail" ? styles.activeTab : undefined}
              role="tab"
              aria-selected={tab === "detail"}
              onClick={() => setTab("detail")}
            >
              Details
            </button>
            <button
              className={tab === "timeline" ? styles.activeTab : undefined}
              role="tab"
              aria-selected={tab === "timeline"}
              onClick={() => void showTimeline()}
            >
              Timeline
            </button>
          </div>
        )}
        {tab === "detail" ? (
          <>
            <dl className={styles.detailList}>
              <Detail label="Event ID" value={event.eventId} mono />
              <Detail label="Schema version" value={event.schemaVersion} />
              <Detail
                label="Timestamp (IST)"
                value={formatIst(event.timestamp)}
              />
              <Detail label="Project" value={event.project} />
              <Detail label="Service" value={event.service} />
              <Detail label="Environment" value={event.environment} />
              <Detail label="Kind" value={event.kind} />
              <Detail label="Level" value={event.level} />
              <Detail label="Message" value={event.message} />
              {event.correlationId && (
                <Detail
                  label="Correlation ID"
                  value={event.correlationId}
                  mono
                />
              )}
              {event.http && (
                <>
                  <Detail label="HTTP method" value={event.http.method} />
                  <Detail
                    label="Route template"
                    value={event.http.route}
                    mono
                  />
                  <Detail label="Status code" value={event.http.statusCode} />
                  <Detail
                    label="Duration"
                    value={`${event.http.durationMs} ms`}
                  />
                  <Detail
                    label="Request bytes"
                    value={event.http.requestBytes ?? "Not stored"}
                  />
                  <Detail
                    label="Response bytes"
                    value={event.http.responseBytes ?? "Not stored"}
                  />
                </>
              )}
              {event.error?.name && (
                <Detail label="Error name" value={event.error.name} />
              )}
              {event.error?.code && (
                <Detail label="Error code" value={event.error.code} />
              )}
              <Detail
                label="Attributes"
                value={
                  Object.keys(event.attributes ?? {}).length
                    ? JSON.stringify(event.attributes, null, 2)
                    : "None stored"
                }
                mono
              />
            </dl>
            {event.diagnostic && (
              <section className={styles.diagnosticDetails}>
                <strong>Sanitized diagnostic metadata</strong>
                <p className={styles.mono}>
                  Fingerprint {event.diagnostic.fingerprint}
                </p>
                <p>
                  {event.diagnostic.redactionCount} redaction
                  {event.diagnostic.redactionCount === 1 ? "" : "s"}
                </p>
                {isAdmin && event.diagnostic.available && !diagnostic && (
                  <button
                    className={styles.secondaryButton}
                    disabled={diagnosticLoading}
                    onClick={onDiagnostic}
                  >
                    <ShieldCheck size={14} />{" "}
                    {diagnosticLoading
                      ? "Loading…"
                      : "View sanitized diagnostics"}
                  </button>
                )}
                {diagnostic && <DiagnosticDetails diagnostic={diagnostic} />}
              </section>
            )}
          </>
        ) : (
          <CorrelationTimeline
            openedEventId={event.eventId}
            timeline={timeline}
            loading={timelineLoading}
            error={timelineError}
          />
        )}
      </aside>
    </div>
  );
}

function CorrelationTimeline({
  openedEventId,
  timeline,
  loading,
  error,
}: {
  openedEventId: string;
  timeline: CorrelationTimelineResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading)
    return (
      <div className={styles.empty}>Loading retained correlation events…</div>
    );
  if (error) return <p className={styles.error}>{error}</p>;
  if (!timeline?.data.length)
    return (
      <div className={styles.empty}>
        No retained events share this correlation ID.
      </div>
    );
  return (
    <section aria-label="Correlation timeline">
      {timeline.truncated && (
        <p className={styles.error}>
          Showing the first {CORRELATION_TIMELINE_LIMIT} of{" "}
          {formatIndianNumber(timeline.total)} retained events.
        </p>
      )}
      <ol className={styles.timelineList}>
        {timeline.data.map((item) => (
          <li
            key={item.eventId}
            className={
              item.eventId === openedEventId
                ? styles.timelineCurrent
                : undefined
            }
          >
            <time dateTime={item.timestamp}>{formatIst(item.timestamp)}</time>
            <div>
              <StatusBadge tone={LEVEL_TONES[item.level]}>
                {item.level}
              </StatusBadge>{" "}
              <strong>{item.service}</strong>
            </div>
            <p>{item.message}</p>
            {item.http && (
              <span className={styles.mono}>
                {item.http.method} {item.http.route} · {item.http.statusCode} ·{" "}
                {item.http.durationMs.toFixed(1)} ms
              </span>
            )}
            {item.error && (
              <span className={styles.mono}>
                {[item.error.name, item.error.code].filter(Boolean).join(" · ")}
              </span>
            )}
            {Object.keys(item.attributes ?? {}).length > 0 && (
              <pre className={styles.mono}>
                {JSON.stringify(item.attributes, null, 2)}
              </pre>
            )}
            {item.eventId === openedEventId && (
              <span className={styles.muted}>Opened event</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? styles.mono : undefined}>{value}</dd>
    </div>
  );
}
function DiagnosticDetails({ diagnostic }: { diagnostic: LogDiagnostic }) {
  return (
    <section aria-label="Sanitized error diagnostics">
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
  return frames.length ? (
    <ol className={`${styles.trace} ${styles.mono}`}>
      {frames.map((frame, index) => (
        <li key={`${frame.file}:${frame.line}:${frame.column}:${index}`}>
          {frame.function ? `${frame.function} · ` : ""}
          {frame.file}:{frame.line}:{frame.column}
        </li>
      ))}
    </ol>
  ) : (
    <p className={styles.muted}>No recognized Node/V8 frames.</p>
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
