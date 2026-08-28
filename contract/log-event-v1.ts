/**
 * The frozen wire contract used by every Ops telemetry producer and consumer
 */

import {
  isRegisteredProjectService,
  LOG_EVENT_PROJECTS,
  LOG_EVENT_SERVICES,
  type LogEventProject,
  type LogEventService,
} from "./project-registry";

export {
  LOG_EVENT_PROJECT_REGISTRY,
  LOG_EVENT_PROJECTS,
  LOG_EVENT_SERVICE_DEFINITIONS,
  LOG_EVENT_SERVICES,
  isRegisteredProjectService,
  type LogEventProject,
  type LogEventService,
} from "./project-registry";

export const LOG_EVENT_SCHEMA_VERSION = 1 as const;

export const LOG_EVENT_ENVIRONMENTS = ["production"] as const;
export const LOG_EVENT_KINDS = ["application", "http"] as const;
export const LOG_EVENT_LEVELS = [
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;

export const LOG_EVENT_ATTRIBUTE_KEYS = [
  "attempt",
  "component",
  "dependency",
  "exitCode",
  "jobName",
  "operation",
  "outcome",
  "queueName",
  "retryable",
  "signal",
] as const;

export type LogEventEnvironment = (typeof LOG_EVENT_ENVIRONMENTS)[number];
export type LogEventKind = (typeof LOG_EVENT_KINDS)[number];
export type LogEventLevel = (typeof LOG_EVENT_LEVELS)[number];
export type LogEventAttributeKey = (typeof LOG_EVENT_ATTRIBUTE_KEYS)[number];
export type LogEventAttributeValue = string | number | boolean;

export type LogEventV1 = {
  schemaVersion: 1;
  eventId: string;
  timestamp: string;
  project: LogEventProject;
  service: LogEventService;
  environment: "production";
  kind: LogEventKind;
  level: LogEventLevel;
  message: string;
  correlationId?: string;
  http?: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
    requestBytes?: number;
    responseBytes?: number;
  };
  error?: {
    name?: string;
    code?: string;
  };
  attributes?: Partial<Record<LogEventAttributeKey, LogEventAttributeValue>>;
};

export type LogEventValidationIssue = {
  path: string;
  message: string;
};

export type LogEventValidationResult =
  | { success: true; data: LogEventV1 }
  | { success: false; issues: LogEventValidationIssue[] };

const ROOT_KEYS = new Set([
  "schemaVersion",
  "eventId",
  "timestamp",
  "project",
  "service",
  "environment",
  "kind",
  "level",
  "message",
  "correlationId",
  "http",
  "error",
  "attributes",
]);
const HTTP_KEYS = new Set([
  "method",
  "route",
  "statusCode",
  "durationMs",
  "requestBytes",
  "responseBytes",
]);
const ERROR_KEYS = new Set(["name", "code"]);
const ATTRIBUTE_KEYS = new Set<string>(LOG_EVENT_ATTRIBUTE_KEYS);
const PROJECTS = new Set<string>(LOG_EVENT_PROJECTS);
const SERVICES = new Set<string>(LOG_EVENT_SERVICES);
const ENVIRONMENTS = new Set<string>(LOG_EVENT_ENVIRONMENTS);
const KINDS = new Set<string>(LOG_EVENT_KINDS);
const LEVELS = new Set<string>(LOG_EVENT_LEVELS);

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const HTTP_METHOD_PATTERN = /^[A-Z]+$/;
const STATIC_ROUTE_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9._~-]*$/;
const PARAM_ROUTE_SEGMENT_PATTERN = /^:[A-Za-z][A-Za-z0-9_]*$/;
const NEXT_ROUTE_SEGMENT_PATTERN =
  /^(?:\[[A-Za-z][A-Za-z0-9_]*\]|\[\.\.\.[A-Za-z][A-Za-z0-9_]*\]|\[\[\.\.\.[A-Za-z][A-Za-z0-9_]*\]\])$/;
const RFC3339_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const CREDENTIAL_PATTERN =
  /(?:\b(?:bearer|basic)\s+\S+|\b(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|session[-_]?id)\b\s*[:=]\s*\S+)/i;

function isValidUtcTimestamp(value: string): boolean {
  if (!RFC3339_UTC_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    return false;
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/,
  );
  if (!match) return false;

  const date = new Date(value);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addUnknownKeyIssues(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: LogEventValidationIssue[],
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({
        path: path ? `${path}.${key}` : key,
        message: "Field is not allowed by LogEventV1",
      });
    }
  }
}

function requireEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  issues: LogEventValidationIssue[],
) {
  if (typeof value !== "string" || !allowed.has(value)) {
    issues.push({ path, message: "Value is not registered in LogEventV1" });
  }
}

function requireBoundedString(
  value: unknown,
  path: string,
  maxLength: number,
  issues: LogEventValidationIssue[],
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    issues.push({
      path,
      message: `Expected a non-empty string no longer than ${maxLength} characters`,
    });
    return false;
  }
  return true;
}

function requireNonNegativeNumber(
  value: unknown,
  path: string,
  issues: LogEventValidationIssue[],
  integer = false,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    issues.push({
      path,
      message: integer
        ? "Expected a non-negative integer"
        : "Expected a finite non-negative number",
    });
  }
}

/** Reject values that are identity data or commonly contain credentials */
export function containsSensitiveLogValue(value: string): boolean {
  return (
    EMAIL_PATTERN.test(value) ||
    IPV4_PATTERN.test(value) ||
    JWT_PATTERN.test(value) ||
    CREDENTIAL_PATTERN.test(value)
  );
}

/**
 * A route must be a framework route template, never a raw URL.
 * Dynamic values use `:param`, `[param]`, `[...param]`, or `[[...param]]` segments.
 */
export function isSafeRouteTemplate(route: string): boolean {
  if (
    route === "/" ||
    route === "*" ||
    route === "unknown" ||
    route === "unmatched"
  ) {
    return true;
  }
  if (
    !route.startsWith("/") ||
    route.includes("?") ||
    route.includes("#") ||
    route.includes("%") ||
    route.includes("//") ||
    /\s/.test(route)
  ) {
    return false;
  }

  return route
    .slice(1)
    .split("/")
    .every(
      (segment) =>
        STATIC_ROUTE_SEGMENT_PATTERN.test(segment) ||
        PARAM_ROUTE_SEGMENT_PATTERN.test(segment) ||
        NEXT_ROUTE_SEGMENT_PATTERN.test(segment),
    );
}

export function validateLogEventV1(input: unknown): LogEventValidationResult {
  const issues: LogEventValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ path: "", message: "Expected a JSON object" }],
    };
  }

  addUnknownKeyIssues(input, ROOT_KEYS, "", issues);

  if (input.schemaVersion !== LOG_EVENT_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", message: "Expected literal 1" });
  }

  if (requireBoundedString(input.eventId, "eventId", 128, issues)) {
    if (!OPAQUE_ID_PATTERN.test(input.eventId)) {
      issues.push({
        path: "eventId",
        message: "Expected an opaque safe identifier",
      });
    }
  }

  if (requireBoundedString(input.timestamp, "timestamp", 32, issues)) {
    if (!isValidUtcTimestamp(input.timestamp)) {
      issues.push({
        path: "timestamp",
        message: "Expected a valid RFC 3339 UTC timestamp",
      });
    }
  }

  requireEnum(input.project, PROJECTS, "project", issues);
  requireEnum(input.service, SERVICES, "service", issues);
  requireEnum(input.environment, ENVIRONMENTS, "environment", issues);
  requireEnum(input.kind, KINDS, "kind", issues);
  requireEnum(input.level, LEVELS, "level", issues);

  if (
    typeof input.project === "string" &&
    PROJECTS.has(input.project) &&
    typeof input.service === "string" &&
    SERVICES.has(input.service) &&
    !isRegisteredProjectService(input.project, input.service)
  ) {
    issues.push({
      path: "service",
      message: "Service is not registered for the selected project",
    });
  }

  if (requireBoundedString(input.message, "message", 2_048, issues)) {
    if (containsSensitiveLogValue(input.message)) {
      issues.push({
        path: "message",
        message: "Message appears to contain credentials or identity data",
      });
    }
  }

  if (input.correlationId !== undefined) {
    if (
      requireBoundedString(input.correlationId, "correlationId", 128, issues) &&
      !OPAQUE_ID_PATTERN.test(input.correlationId)
    ) {
      issues.push({
        path: "correlationId",
        message: "Expected an opaque safe identifier",
      });
    }
  }

  if (input.kind === "http" && input.http === undefined) {
    issues.push({ path: "http", message: "HTTP events require HTTP metadata" });
  }
  if (input.kind === "application" && input.http !== undefined) {
    issues.push({
      path: "http",
      message: "Application events must not include HTTP metadata",
    });
  }

  if (input.http !== undefined) {
    if (!isRecord(input.http)) {
      issues.push({ path: "http", message: "Expected an object" });
    } else {
      addUnknownKeyIssues(input.http, HTTP_KEYS, "http", issues);
      if (requireBoundedString(input.http.method, "http.method", 16, issues)) {
        if (!HTTP_METHOD_PATTERN.test(input.http.method)) {
          issues.push({
            path: "http.method",
            message: "Expected an uppercase HTTP method",
          });
        }
      }
      if (requireBoundedString(input.http.route, "http.route", 512, issues)) {
        if (!isSafeRouteTemplate(input.http.route)) {
          issues.push({
            path: "http.route",
            message:
              "Expected a route template without raw values or query data",
          });
        }
      }
      requireNonNegativeNumber(
        input.http.statusCode,
        "http.statusCode",
        issues,
        true,
      );
      if (
        typeof input.http.statusCode === "number" &&
        (input.http.statusCode < 100 || input.http.statusCode > 599)
      ) {
        issues.push({
          path: "http.statusCode",
          message: "Expected an HTTP status code",
        });
      }
      requireNonNegativeNumber(
        input.http.durationMs,
        "http.durationMs",
        issues,
      );
      if (input.http.requestBytes !== undefined) {
        requireNonNegativeNumber(
          input.http.requestBytes,
          "http.requestBytes",
          issues,
          true,
        );
      }
      if (input.http.responseBytes !== undefined) {
        requireNonNegativeNumber(
          input.http.responseBytes,
          "http.responseBytes",
          issues,
          true,
        );
      }
    }
  }

  if (input.error !== undefined) {
    if (!isRecord(input.error)) {
      issues.push({ path: "error", message: "Expected an object" });
    } else {
      addUnknownKeyIssues(input.error, ERROR_KEYS, "error", issues);
      if (Object.keys(input.error).length === 0) {
        issues.push({
          path: "error",
          message: "Expected at least name or code",
        });
      }
      for (const key of ERROR_KEYS) {
        const value = input.error[key];
        if (value !== undefined) {
          if (requireBoundedString(value, `error.${key}`, 128, issues)) {
            if (!OPAQUE_ID_PATTERN.test(value)) {
              issues.push({
                path: `error.${key}`,
                message: "Expected a safe error identifier without detail text",
              });
            }
          }
        }
      }
    }
  }

  if (input.attributes !== undefined) {
    if (!isRecord(input.attributes)) {
      issues.push({ path: "attributes", message: "Expected an object" });
    } else {
      addUnknownKeyIssues(
        input.attributes,
        ATTRIBUTE_KEYS,
        "attributes",
        issues,
      );
      for (const [key, value] of Object.entries(input.attributes)) {
        if (!ATTRIBUTE_KEYS.has(key)) continue;
        if (
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean"
        ) {
          issues.push({
            path: `attributes.${key}`,
            message: "Expected a string, finite number, or boolean",
          });
          continue;
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
          issues.push({
            path: `attributes.${key}`,
            message: "Expected a finite number",
          });
        }
        if (typeof value === "string") {
          if (value.length === 0 || value.length > 256) {
            issues.push({
              path: `attributes.${key}`,
              message:
                "Expected a non-empty string no longer than 256 characters",
            });
          } else if (containsSensitiveLogValue(value)) {
            issues.push({
              path: `attributes.${key}`,
              message:
                "Attribute appears to contain credentials or identity data",
            });
          }
        }
      }
    }
  }

  if (issues.length > 0) return { success: false, issues };
  return { success: true, data: input as LogEventV1 };
}

export class LogEventV1ValidationError extends Error {
  readonly issues: LogEventValidationIssue[];

  constructor(issues: LogEventValidationIssue[]) {
    super("Invalid LogEventV1");
    this.name = "LogEventV1ValidationError";
    this.issues = issues;
  }
}

export function parseLogEventV1(input: unknown): LogEventV1 {
  const result = validateLogEventV1(input);
  if (!result.success) throw new LogEventV1ValidationError(result.issues);
  return result.data;
}
