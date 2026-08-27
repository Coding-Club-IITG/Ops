import { OPS_RANGES, type OpsRange } from "@/types/range";

export { OPS_RANGES, type OpsRange } from "@/types/range";

export const OPS_RANGE_MILLISECONDS: Record<OpsRange, number> = {
  "1h": 60 * 60 * 1_000,
  "6h": 6 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

export const DEFAULT_LOGS_RANGE: OpsRange = "24h";
export const DEFAULT_METRICS_RANGE: OpsRange = "1h";
export const DEFAULT_SERVICE_RANGE: OpsRange = "24h";
export const DEFAULT_PAGE_SIZE = 50;
export const CORRELATION_TIMELINE_LIMIT = 500;
export const IST_TIME_ZONE = "Asia/Kolkata";
export const IST_UTC_OFFSET = "+05:30";
export const OPERATOR_LOCALE = "en-IN";

export const CHART_COLORS = {
  blue: "var(--chart-blue)",
  purple: "var(--chart-purple)",
  green: "var(--chart-green)",
  yellow: "var(--chart-yellow)",
  red: "var(--chart-red)",
  gray: "var(--chart-gray)",
  crimson: "var(--chart-crimson)",
} as const;

export const LOG_LEVEL_CHART_COLORS = {
  debug: CHART_COLORS.gray,
  info: CHART_COLORS.blue,
  warn: CHART_COLORS.yellow,
  error: CHART_COLORS.red,
  fatal: CHART_COLORS.crimson,
} as const;

export function isOpsRange(value: string | null): value is OpsRange {
  return OPS_RANGES.includes(value as OpsRange);
}
