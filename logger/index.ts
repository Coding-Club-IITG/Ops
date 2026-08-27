import { randomUUID } from "node:crypto";
import {
  LOG_EVENT_ATTRIBUTE_KEYS,
  LOG_EVENT_LEVELS,
  parseLogEventV1,
  type LogEventAttributeKey,
  type LogEventAttributeValue,
  type LogEventLevel,
  type LogEventProject,
  type LogEventService,
  type LogEventV1,
} from "@coding-club-iitg/ops-contract";
import { OPS_LOGGER_INTERNAL, type OpsLoggerInternal } from "./internal.js";

export type OpsLogAttributes = Partial<
  Record<LogEventAttributeKey, LogEventAttributeValue>
>;

export type OpsLogDetails = {
  error?: unknown;
  attributes?: OpsLogAttributes;
  /** Use for jobs and workers. HTTP adapters attach this automatically. */
  correlationId?: string;
};

export type OpsLoggerConfig = {
  project: LogEventProject;
  service: LogEventService;
  ingestionUrl: string;
  secret: string;
  enabled: boolean;
  exportLevels?: readonly LogEventLevel[];
  timeoutMs?: number;
  maxInFlight?: number;
  console?: Pick<Console, "debug" | "info" | "warn" | "error">;
  /** Adapter hook. Prefer the Express/Next entrypoints over setting this directly. */
  getCorrelationId?: () => string | undefined;
};

export type DeliveryStatus = Readonly<{
  pending: number;
  dropped: number;
}>;

export type OpsLogger = {
  debug(message: string, details?: OpsLogDetails): void;
  info(message: string, details?: OpsLogDetails): void;
  warn(message: string, details?: OpsLogDetails): void;
  error(message: string, details?: OpsLogDetails): void;
  fatal(message: string, details?: OpsLogDetails): void;
  flush(): Promise<DeliveryStatus>;
  deliveryStatus(): DeliveryStatus;
};

type Diagnostic = {
  name?: string;
  code?: string;
  message?: string;
  stack?: string;
  cause?: Diagnostic;
};

const DEFAULT_EXPORT_LEVELS = new Set<LogEventLevel>([
  "warn",
  "error",
  "fatal",
]);
const ATTRIBUTE_KEYS = new Set<string>(LOG_EVENT_ATTRIBUTE_KEYS);
const LEVELS = new Set<string>(LOG_EVENT_LEVELS);
const SENSITIVE =
  /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:bearer|basic)\s+\S+|\b(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|session[-_]?id)\b\s*[:=]\s*\S+)/gi;
const ABSOLUTE_PATH =
  /(?:\b[A-Za-z]:\\[^\s:)]+|\/(?:home|Users|private|var|tmp|opt|srv|app)\/[^\s:)]+)/g;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function bounded(value: unknown, max: number, fallback: string): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : String(value);
  } catch {
    text = fallback;
  }
  text = text.replace(SENSITIVE, "[REDACTED]").replace(ABSOLUTE_PATH, "[PATH]");
  text = text.trim();
  return (text || fallback).slice(0, max);
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = bounded(value, 128, "unknown");
  return SAFE_ID.test(result) ? result : undefined;
}

function serializeError(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): Diagnostic {
  if (depth >= 3) return { name: "CauseDepthExceeded" };
  if (typeof value !== "object" || value === null) {
    return {
      name: "NonError",
      message: bounded(value, 1_024, "Unknown error"),
    };
  }
  if (seen.has(value)) return { name: "CircularCause" };
  seen.add(value);
  const source = value as Record<string, unknown>;
  const diagnostic: Diagnostic = {
    name: bounded(
      source.name,
      128,
      value instanceof Error ? value.name : "Error",
    ),
  };
  if (source.code !== undefined)
    diagnostic.code = bounded(source.code, 128, "unknown");
  if (source.message !== undefined)
    diagnostic.message = bounded(source.message, 1_024, "Unknown error");
  if (source.stack !== undefined)
    diagnostic.stack = bounded(source.stack, 8_192, "Stack unavailable");
  if (source.cause !== undefined)
    diagnostic.cause = serializeError(source.cause, depth + 1, seen);
  return diagnostic;
}

function safeAttributes(
  input: OpsLogAttributes | undefined,
): OpsLogAttributes | undefined {
  if (!input || typeof input !== "object") return undefined;
  const output: OpsLogAttributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ATTRIBUTE_KEYS.has(key)) continue;
    if (typeof value === "boolean") output[key as LogEventAttributeKey] = value;
    else if (typeof value === "number" && Number.isFinite(value))
      output[key as LogEventAttributeKey] = value;
    else if (typeof value === "string") {
      const clean = bounded(value, 256, "unknown");
      output[key as LogEventAttributeKey] = clean;
    }
  }
  return Object.keys(output).length ? output : undefined;
}

function validateConfig(config: OpsLoggerConfig): void {
  if (!config || typeof config !== "object")
    throw new TypeError("Logger config is required");
  if (typeof config.enabled !== "boolean")
    throw new TypeError("enabled must be explicit");
  if (!config.project || !config.service)
    throw new TypeError("project and service are required");
  if (!config.secret) throw new TypeError("secret is required");
  let url: URL;
  try {
    url = new URL(config.ingestionUrl);
  } catch {
    throw new TypeError("ingestionUrl must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TypeError("ingestionUrl must be an HTTP(S) URL");
  if (config.exportLevels?.some((level) => !LEVELS.has(level)))
    throw new TypeError("exportLevels contains an invalid level");
  if (
    config.timeoutMs !== undefined &&
    (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)
  )
    throw new TypeError("timeoutMs must be positive");
  if (
    config.maxInFlight !== undefined &&
    (!Number.isInteger(config.maxInFlight) || config.maxInFlight <= 0)
  )
    throw new TypeError("maxInFlight must be a positive integer");
  // Contract validation also checks the project/service registry pair
  parseLogEventV1({
    schemaVersion: 1,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    project: config.project,
    service: config.service,
    environment: "production",
    kind: "application",
    level: "info",
    message: "logger-config-check",
  });
}

export function createOpsLogger(config: OpsLoggerConfig): OpsLogger {
  validateConfig(config);
  const output = config.console ?? console;
  const exported = config.exportLevels
    ? new Set(config.exportLevels)
    : DEFAULT_EXPORT_LEVELS;
  const timeoutMs = config.timeoutMs ?? 2_000;
  const maxInFlight = config.maxInFlight ?? 8;
  const pending = new Set<Promise<void>>();
  let dropped = 0;

  const status = (): DeliveryStatus =>
    Object.freeze({ pending: pending.size, dropped });

  function deliver(event: LogEventV1, diagnostic?: Diagnostic): void {
    if (!config.enabled || !exported.has(event.level)) return;
    if (pending.size >= maxInFlight) {
      dropped += 1;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const task = fetch(config.ingestionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...event,
        ...(diagnostic ? { error: diagnostic } : {}),
      }),
      signal: controller.signal,
    })
      .then(
        (response) => {
          if (response.status !== 202) dropped += 1;
        },
        () => {
          dropped += 1;
        },
      )
      .finally(() => {
        clearTimeout(timer);
        pending.delete(task);
      });
    pending.add(task);
  }

  function log(
    level: LogEventLevel,
    message: string,
    details: OpsLogDetails = {},
  ): void {
    try {
      const safeMessage = bounded(message, 2_048, "Log event");
      const diagnostic =
        details.error === undefined ? undefined : serializeError(details.error);
      const correlationId =
        safeIdentifier(details.correlationId) ??
        safeIdentifier(config.getCorrelationId?.());
      const attributes = safeAttributes(details.attributes);
      const errorName = diagnostic
        ? safeIdentifier(diagnostic.name)
        : undefined;
      const errorCode = diagnostic
        ? safeIdentifier(diagnostic.code)
        : undefined;
      const event = parseLogEventV1({
        schemaVersion: 1,
        eventId: randomUUID(),
        timestamp: new Date().toISOString(),
        project: config.project,
        service: config.service,
        environment: "production",
        kind: "application",
        level,
        message: safeMessage,
        ...(correlationId ? { correlationId } : {}),
        ...(errorName || errorCode
          ? {
              error: {
                ...(errorName ? { name: errorName } : {}),
                ...(errorCode ? { code: errorCode } : {}),
              },
            }
          : {}),
        ...(attributes ? { attributes } : {}),
      });
      const local = { ...event, ...(diagnostic ? { diagnostic } : {}) };
      const method =
        level === "debug"
          ? "debug"
          : level === "info"
            ? "info"
            : level === "warn"
              ? "warn"
              : "error";
      try {
        output[method](JSON.stringify(local));
      } catch {
        /* local sink failures never reach the app */
      }
      deliver(event, diagnostic);
    } catch {
      // Logging is deliberately best effort. Invalid runtime details are dropped.
      dropped += 1;
    }
  }

  const logger: OpsLogger & { [OPS_LOGGER_INTERNAL]: OpsLoggerInternal } = {
    debug: (message, details) => log("debug", message, details),
    info: (message, details) => log("info", message, details),
    warn: (message, details) => log("warn", message, details),
    error: (message, details) => log("error", message, details),
    fatal: (message, details) => log("fatal", message, details),
    deliveryStatus: status,
    async flush() {
      await Promise.allSettled([...pending]);
      return status();
    },
    [OPS_LOGGER_INTERNAL]: {
      emitHttp(input) {
        try {
          const event = parseLogEventV1({
            schemaVersion: 1,
            eventId: randomUUID(),
            timestamp: new Date().toISOString(),
            project: config.project,
            service: config.service,
            environment: "production",
            kind: "http",
            level: input.level,
            message: bounded(input.message, 2_048, "HTTP request completed"),
            correlationId: input.correlationId,
            http: {
              method: input.method,
              route: input.route,
              statusCode: input.statusCode,
              durationMs: input.durationMs,
            },
          });
          const method =
            input.level === "warn"
              ? "warn"
              : input.level === "error" || input.level === "fatal"
                ? "error"
                : "info";
          try {
            output[method](JSON.stringify(event));
          } catch {
            /* best effort */
          }
          deliver(event);
        } catch {
          dropped += 1;
        }
      },
    },
  };
  return logger;
}

export type { LogEventLevel, LogEventProject, LogEventService, LogEventV1 };
