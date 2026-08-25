import { z } from "zod";
import {
  LOG_EVENT_KINDS,
  LOG_EVENT_LEVELS,
  LOG_EVENT_PROJECTS,
  LOG_EVENT_SERVICES,
} from "@contracts/log-event-v1/log-event-v1";

const optionalDate = z.string().datetime({ offset: true }).optional();

export const logsQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  project: z.enum(LOG_EVENT_PROJECTS).optional(),
  service: z.enum(LOG_EVENT_SERVICES).optional(),
  kind: z.enum(LOG_EVENT_KINDS).optional(),
  level: z.enum(LOG_EVENT_LEVELS).optional(),
  correlationId: z.string().min(1).max(128).optional(),
  route: z.string().min(1).max(512).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  durationMin: z.coerce.number().nonnegative().optional(),
  durationMax: z.coerce.number().nonnegative().optional(),
  q: z.string().trim().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(["timestamp", "durationMs"]).default("timestamp"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type LogsQuery = z.infer<typeof logsQuerySchema>;

export function parseLogsQuery(url: string): LogsQuery {
  const params = new URL(url).searchParams;
  return logsQuerySchema.parse(Object.fromEntries(params.entries()));
}

export const metricsRangeSchema = z.enum(["1h", "6h", "24h", "7d", "30d"]);
export type MetricsRange = z.infer<typeof metricsRangeSchema>;

export function parseMetricsRange(url: string): MetricsRange {
  return metricsRangeSchema.parse(
    new URL(url).searchParams.get("range") ?? "1h",
  );
}
