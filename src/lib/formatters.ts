import {
  IST_TIME_ZONE,
  IST_UTC_OFFSET,
  OPERATOR_LOCALE,
} from "@/lib/ops-constants";

const INDIAN_NUMBER_FORMAT = new Intl.NumberFormat(OPERATOR_LOCALE);
const IST_DATE_TIME_FORMAT = new Intl.DateTimeFormat(OPERATOR_LOCALE, {
  timeZone: IST_TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "medium",
});
const IST_SHORT_DATE_TIME_FORMAT = new Intl.DateTimeFormat(OPERATOR_LOCALE, {
  timeZone: IST_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});
const IST_TIME_FORMAT = new Intl.DateTimeFormat(OPERATOR_LOCALE, {
  timeZone: IST_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export function formatIndianNumber(value: number): string {
  return INDIAN_NUMBER_FORMAT.format(value);
}

export function formatIst(value: string | Date): string {
  return IST_DATE_TIME_FORMAT.format(new Date(value));
}

export function formatShortIst(value: string | Date): string {
  return IST_SHORT_DATE_TIME_FORMAT.format(new Date(value));
}

export function formatIstTime(value: string | Date): string {
  return IST_TIME_FORMAT.format(new Date(value));
}

export function formatIstInput(value?: string | null): string {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function parseIstInput(value: string): string | undefined {
  return value
    ? new Date(`${value}:00${IST_UTC_OFFSET}`).toISOString()
    : undefined;
}

export function formatBytes(value = 0): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1_024)),
  );
  return `${(value / 1_024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatCompactBytes(value: number): string {
  if (value < 1_024) return `${value.toFixed(0)} B`;
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(0)} KiB`;
  if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(0)} MiB`;
  return `${(value / 1_024 ** 3).toFixed(1)} GiB`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatMilliseconds(value = 0): string {
  return `${value.toFixed(1)} ms`;
}

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
}
