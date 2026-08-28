"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { MetricDimensionValue } from "@contract/metric-event-v1";
import { apiFetch } from "@/lib/api";
import { CHART_COLORS } from "@/lib/ops-constants";
import type {
  ProjectMetricCatalog,
  ProjectMetricResult,
} from "@/types/ops.types";
import { StatCard } from "@/features/stat-card";
import { TimeSeriesPanel } from "@/features/time-series-panel";
import styles from "@/features/ops.module.scss";

const RANGES = ["1h", "6h", "24h", "7d", "30d", "90d"] as const;
const RANGE_MS: Record<(typeof RANGES)[number], number> = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  "90d": 90 * 24 * 3_600_000,
};
const COLORS = Object.values(CHART_COLORS);

export function ProjectMetricsExplorer() {
  const [catalog, setCatalog] = useState<ProjectMetricCatalog>({
    projects: [],
    metrics: [],
    dimensions: [],
  });
  const [project, setProject] = useState("");
  const [service, setService] = useState("");
  const [metric, setMetric] = useState("");
  const [range, setRange] = useState<(typeof RANGES)[number]>("24h");
  const [filters, setFilters] = useState<Record<string, MetricDimensionValue>>(
    {},
  );
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [result, setResult] = useState<ProjectMetricResult | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadCatalog = useCallback(async () => {
    try {
      const response = (await apiFetch(
        "/project-metrics/catalog",
        {},
        {
          project: project || undefined,
          service: service || undefined,
          metric: metric || undefined,
        },
      )) as { data: ProjectMetricCatalog };
      setCatalog(response.data);
      setCatalogError("");
      if (!project) {
        setProject(response.data.projects[0]?.project || "");
        setMetric("");
      } else {
        setMetric((current) =>
          response.data.metrics.includes(current)
            ? current
            : response.data.metrics[0] || "",
        );
      }
    } catch {
      setCatalogError("Project metric catalog is unavailable.");
    }
  }, [metric, project, service]);

  useEffect(() => {
    void loadCatalog();
    const timer = window.setInterval(() => void loadCatalog(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadCatalog]);

  const runQuery = useCallback(async () => {
    if (!project || !metric) return;
    setLoading(true);
    setQueryError("");
    const to = new Date();
    const from = new Date(to.getTime() - RANGE_MS[range]);
    try {
      const response = (await apiFetch("/project-metrics/query", {
        method: "POST",
        body: JSON.stringify({
          project,
          ...(service ? { service } : {}),
          metric,
          from: from.toISOString(),
          to: to.toISOString(),
          filters,
          groupBy,
        }),
      })) as { data: ProjectMetricResult };
      setResult(response.data);
    } catch {
      setQueryError("Project metric query failed.");
    } finally {
      setLoading(false);
    }
  }, [filters, groupBy, metric, project, range, service]);

  useEffect(() => {
    void runQuery();
  }, [runQuery]);

  const selectedProject = catalog.projects.find(
    (item) => item.project === project,
  );
  const series = useMemo(() => chartData(result), [result]);
  const lines = useMemo(
    () =>
      (result?.groups.slice(0, 12) ?? []).map((group, index) => ({
        key: `group-${index}`,
        name: dimensionLabel(group.dimensions, groupBy),
        color: COLORS[index % COLORS.length],
      })),
    [groupBy, result],
  );

  return (
    <section className={styles.metricSection} aria-busy={loading}>
      {(catalogError || queryError) && (
        <p className={styles.error} role="alert">
          {catalogError || queryError}
        </p>
      )}
      {!catalog.projects.length ? (
        <div className={styles.empty}>
          No project metrics have been received in the last 90 days.
        </div>
      ) : (
        <>
          <div className={styles.metricExplorerControls}>
            <label className={styles.fieldLabel}>
              Project
              <select
                className={styles.select}
                value={project}
                onChange={(event) => {
                  setProject(event.target.value);
                  setService("");
                  setMetric("");
                  setFilters({});
                  setGroupBy([]);
                }}
              >
                {catalog.projects.map((item) => (
                  <option key={item.project}>{item.project}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Service
              <select
                className={styles.select}
                value={service}
                onChange={(event) => {
                  setService(event.target.value);
                  setMetric("");
                  setFilters({});
                  setGroupBy([]);
                }}
              >
                <option value="">All services</option>
                {selectedProject?.services.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Metric
              <select
                className={styles.select}
                value={metric}
                onChange={(event) => {
                  setMetric(event.target.value);
                  setFilters({});
                  setGroupBy([]);
                }}
              >
                {catalog.metrics.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Range
              <select
                className={styles.select}
                value={range}
                onChange={(event) =>
                  setRange(event.target.value as (typeof RANGES)[number])
                }
              >
                {RANGES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <button
              className={styles.button}
              type="button"
              onClick={() => void runQuery()}
              disabled={!metric || loading}
            >
              <RefreshCw size={14} /> {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {catalog.dimensions.length > 0 && (
            <div className={styles.dimensionControls}>
              {catalog.dimensions.map((dimension) => (
                <div className={styles.dimensionControl} key={dimension.key}>
                  <label className={styles.fieldLabel}>
                    {dimension.key}
                    <select
                      className={styles.select}
                      value={
                        filters[dimension.key] === undefined
                          ? ""
                          : JSON.stringify(filters[dimension.key])
                      }
                      onChange={(event) => {
                        setFilters((current) => {
                          const next = { ...current };
                          if (!event.target.value) delete next[dimension.key];
                          else
                            next[dimension.key] = JSON.parse(
                              event.target.value,
                            ) as MetricDimensionValue;
                          return next;
                        });
                      }}
                    >
                      <option value="">Any observed value</option>
                      {dimension.values.map((value) => (
                        <option
                          key={JSON.stringify(value)}
                          value={JSON.stringify(value)}
                        >
                          {String(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={groupBy.includes(dimension.key)}
                      onChange={(event) =>
                        setGroupBy((current) =>
                          event.target.checked
                            ? [...current, dimension.key].slice(0, 6)
                            : current.filter((key) => key !== dimension.key),
                        )
                      }
                    />
                    Group by
                  </label>
                </div>
              ))}
            </div>
          )}

          <div className={`${styles.statGrid} ${styles.projectMetricStatGrid}`}>
            <StatCard
              label="Summed value"
              value={formatNumber(result?.totals.summedValue)}
              detail={metric || undefined}
            />
            <StatCard
              label="Event count"
              value={formatNumber(result?.totals.eventCount)}
              detail={`${result?.bucketDurationSeconds ?? 0}s automatic buckets`}
            />
          </div>

          <div className={styles.grid}>
            <TimeSeriesPanel
              title="Summed values over time"
              meta={`Top ${Math.min(lines.length, 12)} groups`}
              data={series.sums}
              lines={lines}
              formatValue={(value) => formatNumber(Number(value))}
              fullWidth
              showLegend={lines.length > 1}
              empty="No metric events match these controls."
            />
            <TimeSeriesPanel
              title="Event counts over time"
              meta={`${result?.bucketDurationSeconds ?? 0}s buckets`}
              data={series.counts}
              lines={lines}
              formatValue={(value) => formatNumber(Number(value))}
              fullWidth
              showLegend={lines.length > 1}
              empty="No metric events match these controls."
            />
            <article className={`${styles.panel} ${styles.panelWide}`}>
              <div className={styles.panelHeader}>
                <h2>Grouped results</h2>
                <span className={styles.muted}>Top 100 combinations</span>
              </div>
              {result?.truncated && (
                <p className={styles.truncationNotice}>
                  More than 100 combinations matched. Only the leading 100 are
                  shown and charts use the leading 12.
                </p>
              )}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Dimensions</th>
                      <th>Summed value</th>
                      <th>Event count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result?.groups.map((group) => (
                      <tr key={groupKey(group.dimensions)}>
                        <td>{dimensionLabel(group.dimensions, groupBy)}</td>
                        <td>{formatNumber(group.summedValue)}</td>
                        <td>{formatNumber(group.eventCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!result?.groups.length && (
                  <div className={styles.empty}>No grouped results.</div>
                )}
              </div>
            </article>
          </div>
        </>
      )}
    </section>
  );
}

function groupKey(dimensions: Record<string, MetricDimensionValue>): string {
  return JSON.stringify(dimensions);
}

function dimensionLabel(
  dimensions: Record<string, MetricDimensionValue>,
  groupBy: string[],
): string {
  if (!groupBy.length) return "All events";
  return groupBy
    .map(
      (key) =>
        `${key}=${dimensions[key] === undefined ? "(missing)" : String(dimensions[key])}`,
    )
    .join(" · ");
}

function chartData(result: ProjectMetricResult | null) {
  const sums = new Map<string, Record<string, string | number | null>>();
  const counts = new Map<string, Record<string, string | number | null>>();
  const groupIds = new Map(
    (result?.groups.slice(0, 12) ?? []).map((group, index) => [
      groupKey(group.dimensions),
      `group-${index}`,
    ]),
  );
  for (const point of result?.series ?? []) {
    const key = groupIds.get(groupKey(point.dimensions));
    if (!key) continue;
    const sum = sums.get(point.timestamp) ?? { timestamp: point.timestamp };
    const count = counts.get(point.timestamp) ?? { timestamp: point.timestamp };
    sum[key] = point.summedValue;
    count[key] = point.eventCount;
    sums.set(point.timestamp, sum);
    counts.set(point.timestamp, count);
  }
  return { sums: [...sums.values()], counts: [...counts.values()] };
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(
    value,
  );
}
