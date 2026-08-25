import type { StoredLogEvent } from "@/lib/server/logs/log-repository";

const COLUMNS = [
  "eventId",
  "timestamp",
  "project",
  "service",
  "kind",
  "level",
  "message",
  "correlationId",
  "method",
  "route",
  "statusCode",
  "durationMs",
  "errorName",
  "errorCode",
] as const;

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function logsToCsv(logs: StoredLogEvent[]): string {
  const rows = logs.map((log) =>
    [
      log.eventId,
      log.timestamp,
      log.project,
      log.service,
      log.kind,
      log.level,
      log.message,
      log.correlationId,
      log.http?.method,
      log.http?.route,
      log.http?.statusCode,
      log.http?.durationMs,
      log.error?.name,
      log.error?.code,
    ]
      .map(escapeCsv)
      .join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\n");
}

export function clampExportWindow(
  from: string | undefined,
  to: string | undefined,
  now = new Date(),
): { from: string; to: string } {
  const end = to ? new Date(to) : now;
  const requestedStart = from
    ? new Date(from)
    : new Date(end.getTime() - 24 * 60 * 60 * 1_000);
  const earliest = new Date(end.getTime() - 24 * 60 * 60 * 1_000);
  const start = requestedStart < earliest ? earliest : requestedStart;
  return { from: start.toISOString(), to: end.toISOString() };
}
