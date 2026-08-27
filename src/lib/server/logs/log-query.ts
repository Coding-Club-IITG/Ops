import { z } from "zod";
import {
  LOG_EVENT_KINDS,
  LOG_EVENT_LEVELS,
  LOG_EVENT_PROJECTS,
  LOG_EVENT_SERVICES,
} from "@contracts/log-event-v1/log-event-v1";
import {
  DEFAULT_PAGE_SIZE,
  OPS_RANGES,
  type OpsRange,
} from "@/lib/ops-constants";

const optionalDate = z.string().datetime({ offset: true }).optional();

export const logsQuerySchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    eventId: z.string().trim().min(1).max(128).optional(),
    project: z.enum(LOG_EVENT_PROJECTS).optional(),
    service: z.enum(LOG_EVENT_SERVICES).optional(),
    kind: z.enum(LOG_EVENT_KINDS).optional(),
    level: z.enum(LOG_EVENT_LEVELS).optional(),
    correlationId: z.string().trim().min(1).max(128).optional(),
    method: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .regex(/^[A-Z]+$/)
      .optional(),
    route: z.string().trim().min(1).max(512).optional(),
    statusCode: z.coerce.number().int().min(100).max(599).optional(),
    statusClass: z.enum(["1xx", "2xx", "3xx", "4xx", "5xx"]).optional(),
    durationMin: z.coerce.number().nonnegative().optional(),
    durationMax: z.coerce.number().nonnegative().optional(),
    q: z.string().trim().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    sort: z.enum(["timestamp", "durationMs"]).default("timestamp"),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .superRefine((query, context) => {
    if (
      query.from &&
      query.to &&
      Date.parse(query.from) > Date.parse(query.to)
    ) {
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must be before or equal to to",
      });
    }
    if (
      query.durationMin !== undefined &&
      query.durationMax !== undefined &&
      query.durationMin > query.durationMax
    ) {
      context.addIssue({
        code: "custom",
        path: ["durationMin"],
        message: "durationMin must be less than or equal to durationMax",
      });
    }
    if (
      query.from &&
      query.to &&
      Date.parse(query.to) - Date.parse(query.from) > 30 * 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Log ranges cannot exceed 30 days",
      });
    }
  });

export type LogsQuery = z.infer<typeof logsQuerySchema>;

export function parseLogsQuery(url: string): LogsQuery {
  const params = new URL(url).searchParams;
  return logsQuerySchema.parse(Object.fromEntries(params.entries()));
}

export const metricsRangeSchema = z.enum(OPS_RANGES);
export type MetricsRange = OpsRange;

export function parseMetricsRange(url: string): MetricsRange {
  return metricsRangeSchema.parse(
    new URL(url).searchParams.get("range") ?? "1h",
  );
}
