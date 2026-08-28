import {
  isRegisteredProjectService,
  LOG_EVENT_PROJECTS,
  LOG_EVENT_SERVICES,
  type LogEventProject,
  type LogEventService,
} from "./project-registry";

export const METRIC_EVENT_SCHEMA_VERSION = 1 as const;
export const METRIC_DIMENSION_LIMIT = 24;
export const METRIC_DIMENSION_KEY_MAX_LENGTH = 64;
export const METRIC_DIMENSION_VALUE_MAX_LENGTH = 256;

export type MetricDimensionValue = string | number | boolean;
export type MetricEventV1 = {
  schemaVersion: 1;
  eventId: string;
  timestamp: string;
  project: LogEventProject;
  service: LogEventService;
  name: string;
  value: number;
  dimensions: Record<string, MetricDimensionValue>;
};
export type MetricEventValidationIssue = { path: string; message: string };
export type MetricEventValidationResult =
  | { success: true; data: MetricEventV1 }
  | { success: false; issues: MetricEventValidationIssue[] };

const ROOT_KEYS = new Set([
  "schemaVersion",
  "eventId",
  "timestamp",
  "project",
  "service",
  "name",
  "value",
  "dimensions",
]);
const PROJECTS = new Set<string>(LOG_EVENT_PROJECTS);
const SERVICES = new Set<string>(LOG_EVENT_SERVICES);
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const METRIC_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const DIMENSION_KEY = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CREDENTIAL_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "credential",
  "credentials",
  "token",
  "authtoken",
  "authenticationtoken",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "accesskey",
  "privatekey",
  "session",
  "sessionid",
]);
const AUTH_VALUE =
  /^(?:bearer|basic)\s+\S+|^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$|^(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}$|^AKIA[A-Z0-9]{16}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function realUtcTimestamp(value: string): boolean {
  if (!RFC3339_UTC.test(value) || Number.isNaN(Date.parse(value))) return false;
  const parsed = new Date(value);
  return parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

export function isCredentialMetricDimensionKey(key: string): boolean {
  return CREDENTIAL_KEYS.has(key.replaceAll(/[-_]/g, "").toLowerCase());
}

export function isRecognizableAuthenticationToken(value: string): boolean {
  return AUTH_VALUE.test(value.trim());
}

export function validateMetricEventV1(
  input: unknown,
): MetricEventValidationResult {
  const issues: MetricEventValidationIssue[] = [];
  if (!record(input))
    return {
      success: false,
      issues: [{ path: "", message: "Expected a JSON object" }],
    };

  for (const key of Object.keys(input)) {
    if (!ROOT_KEYS.has(key))
      issues.push({
        path: key,
        message: "Field is not allowed by MetricEventV1",
      });
  }
  if (input.schemaVersion !== 1)
    issues.push({ path: "schemaVersion", message: "Expected literal 1" });
  if (typeof input.eventId !== "string" || !OPAQUE_ID.test(input.eventId))
    issues.push({
      path: "eventId",
      message: "Expected an opaque safe identifier",
    });
  if (
    typeof input.timestamp !== "string" ||
    input.timestamp.length > 32 ||
    !realUtcTimestamp(input.timestamp)
  )
    issues.push({
      path: "timestamp",
      message: "Expected a valid RFC 3339 UTC timestamp",
    });
  if (typeof input.project !== "string" || !PROJECTS.has(input.project))
    issues.push({ path: "project", message: "Project is not registered" });
  if (typeof input.service !== "string" || !SERVICES.has(input.service))
    issues.push({ path: "service", message: "Service is not registered" });
  if (
    typeof input.project === "string" &&
    typeof input.service === "string" &&
    PROJECTS.has(input.project) &&
    SERVICES.has(input.service) &&
    !isRegisteredProjectService(input.project, input.service)
  )
    issues.push({
      path: "service",
      message: "Service is not registered for the selected project",
    });
  if (typeof input.name !== "string" || !METRIC_NAME.test(input.name))
    issues.push({
      path: "name",
      message: "Expected a metric name no longer than 128 characters",
    });
  if (typeof input.value !== "number" || !Number.isFinite(input.value))
    issues.push({ path: "value", message: "Expected a finite number" });

  if (!record(input.dimensions)) {
    issues.push({ path: "dimensions", message: "Expected an object" });
  } else {
    const entries = Object.entries(input.dimensions);
    if (entries.length > METRIC_DIMENSION_LIMIT)
      issues.push({
        path: "dimensions",
        message: `Expected at most ${METRIC_DIMENSION_LIMIT} dimensions`,
      });
    for (const [key, value] of entries) {
      const path = `dimensions.${key}`;
      if (!DIMENSION_KEY.test(key)) {
        issues.push({ path, message: "Invalid dimension key" });
        continue;
      }
      if (isCredentialMetricDimensionKey(key)) {
        issues.push({ path, message: "Credential dimensions are forbidden" });
        continue;
      }
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      )
        issues.push({
          path,
          message: "Expected a string, finite number, or boolean",
        });
      else if (typeof value === "number" && !Number.isFinite(value))
        issues.push({ path, message: "Expected a finite number" });
      else if (
        typeof value === "string" &&
        (value.length === 0 ||
          value.length > METRIC_DIMENSION_VALUE_MAX_LENGTH ||
          isRecognizableAuthenticationToken(value))
      )
        issues.push({
          path,
          message:
            value.length === 0 ||
            value.length > METRIC_DIMENSION_VALUE_MAX_LENGTH
              ? `Expected a non-empty string no longer than ${METRIC_DIMENSION_VALUE_MAX_LENGTH} characters`
              : "Recognizable authentication tokens are forbidden",
        });
    }
  }

  return issues.length
    ? { success: false, issues }
    : { success: true, data: input as MetricEventV1 };
}

export class MetricEventV1ValidationError extends Error {
  constructor(readonly issues: MetricEventValidationIssue[]) {
    super("Invalid MetricEventV1");
    this.name = "MetricEventV1ValidationError";
  }
}

export function parseMetricEventV1(input: unknown): MetricEventV1 {
  const result = validateMetricEventV1(input);
  if (!result.success) throw new MetricEventV1ValidationError(result.issues);
  return result.data;
}
