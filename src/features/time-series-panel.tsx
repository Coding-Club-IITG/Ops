"use client";

import type { ReactNode } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/ChartTooltip";
import { formatIst, formatIstTime } from "@/lib/formatters";
import styles from "@/features/ops.module.scss";

export type TimeSeriesDatum = Record<string, string | number | null>;
export type TimeSeriesLine = {
  key: string;
  name: string;
  color: string;
};

export function TimeSeriesPanel({
  title,
  meta,
  data,
  lines,
  formatValue,
  formatYAxis,
  summary,
  empty = "No samples reported.",
  fullWidth = false,
  showLegend = false,
}: {
  title: string;
  meta: ReactNode;
  data: TimeSeriesDatum[];
  lines: TimeSeriesLine[];
  formatValue: (value: unknown, name: string, dataKey: string) => ReactNode;
  formatYAxis?: (value: number) => string;
  summary?: string;
  empty?: string;
  fullWidth?: boolean;
  showLegend?: boolean;
}) {
  return (
    <article
      className={`${styles.panel}${fullWidth ? ` ${styles.panelWide}` : ""}`}
    >
      <div className={styles.panelHeader}>
        <h2>{title}</h2>
        <span className={styles.muted}>{meta}</span>
      </div>
      <div className={styles.chart}>
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 12, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                minTickGap={32}
                tickFormatter={(value) => formatIstTime(String(value))}
              />
              <YAxis
                width={48}
                tickFormatter={(value) =>
                  formatYAxis ? formatYAxis(Number(value)) : String(value)
                }
              />
              <Tooltip
                cursor={false}
                content={(props) => (
                  <ChartTooltip
                    {...props}
                    formatLabel={(value) => formatIst(String(value))}
                    formatValue={formatValue}
                  />
                )}
              />
              {showLegend && <Legend />}
              {lines.map((line) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.name}
                  stroke={line.color}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.empty}>{empty}</div>
        )}
      </div>
      {summary && <p className={styles.srOnly}>{summary}</p>}
    </article>
  );
}
