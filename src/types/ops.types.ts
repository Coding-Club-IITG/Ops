import type {
  LogEventProject,
  LogEventService,
  LogEventV1,
} from "@contracts/log-event-v1/log-event-v1";

export type DiagnosticFrame = {
  function?: string;
  file: string;
  line: number;
  column: number;
};
export type DiagnosticCause = {
  name?: string;
  code?: string;
  message: string;
  frames: DiagnosticFrame[];
  cause?: DiagnosticCause;
};
export type LogDiagnostic = {
  message: string;
  frames: DiagnosticFrame[];
  cause?: DiagnosticCause;
  fingerprint: string;
  redactionCount: number;
};
export type StoredLogEvent = LogEventV1 & {
  ingestedAt: string;
  diagnostic: {
    fingerprint: string;
    redactionCount: number;
    available: boolean;
  } | null;
};

export type LogsQuery = {
  from?: string;
  to?: string;
  project?: LogEventProject;
  service?: LogEventService;
  kind?: "application" | "http";
  level?: "debug" | "info" | "warn" | "error" | "fatal";
  correlationId?: string;
  route?: string;
  statusCode?: number;
  durationMin?: number;
  durationMax?: number;
  q?: string;
  limit?: number;
  offset?: number;
  sort?: "timestamp" | "durationMs";
  order?: "asc" | "desc";
};

export type ServiceSummary = {
  service: LogEventService;
  project: LogEventProject;
  lastSeenAt: string | null;
  errorsLastHour: number;
  status: "healthy" | "stale" | "unknown";
};

export type Pm2Metric = {
  name: string;
  status: string;
  uptimeSeconds: number;
  restartCount: number;
  cpuPercent: number;
  memoryMb: number;
};

export type MetricSnapshot = {
  measuredAt: string;
  uptimeSeconds: number;
  cpu: { usagePercent: number; cores: number[] };
  memory: { totalBytes: number; usedBytes: number };
  disk: { readsPerSecond: number; writesPerSecond: number };
  network: {
    rxBytesPerSecond: number;
    txBytesPerSecond: number;
    activeConnections: number;
  };
  pm2: Pm2Metric[];
};

export type OverviewData = {
  logsLast24Hours: number;
  errorsLast24Hours: number;
  errorRate: number;
  services: ServiceSummary[];
  metrics: MetricSnapshot | null;
  metricsStale: boolean;
};
