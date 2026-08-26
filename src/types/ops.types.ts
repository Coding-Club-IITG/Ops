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
  eventId?: string;
  project?: LogEventProject;
  service?: LogEventService;
  kind?: "application" | "http";
  level?: "debug" | "info" | "warn" | "error" | "fatal";
  correlationId?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  statusClass?: "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
  durationMin?: number;
  durationMax?: number;
  q?: string;
  limit?: number;
  offset?: number;
  sort?: "timestamp" | "durationMs";
  order?: "asc" | "desc";
};

export type LogViewColumn =
  | "timestamp"
  | "projectService"
  | "kind"
  | "level"
  | "message"
  | "method"
  | "route"
  | "statusCode"
  | "durationMs"
  | "correlationId"
  | "error"
  | `attribute:${string}`;

export type LogView = {
  id: string;
  name: string;
  description?: string;
  relativeTime: "1h" | "6h" | "24h" | "7d" | "30d";
  filters: Omit<
    LogsQuery,
    "from" | "to" | "limit" | "offset" | "sort" | "order"
  >;
  sort: { field: "timestamp" | "durationMs"; order: "asc" | "desc" };
  visibleColumns: LogViewColumn[];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type LogVolumeResponse = {
  range: { from: string; to: string };
  bucketDurationSeconds: number;
  buckets: Array<{
    timestamp: string;
    debug: number;
    info: number;
    warn: number;
    error: number;
    fatal: number;
    total: number;
  }>;
  fetchedAt: string;
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
  memoryBytes: number;
};

export type OsProcessMetric = {
  name: string;
  pid: number;
  cpuPercent: number;
  memoryBytes: number;
};

export type MetricSnapshot = {
  measuredAt: string;
  uptimeSeconds: number;
  cpu: {
    usagePercent: number;
    cores: number[];
    averagePercent?: number;
    minimumCorePercent?: number;
    maximumCorePercent?: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes?: number;
    availableBytes?: number;
    pressurePercent?: number;
  };
  disk: {
    readsPerSecond: number;
    writesPerSecond: number;
    waitMilliseconds?: number;
    totalBytes?: number;
    usedBytes?: number;
    freeBytes?: number;
    partitions?: Array<{
      mount: string;
      totalBytes: number;
      usedBytes: number;
      freeBytes: number;
      usePercent: number;
    }>;
  };
  network: {
    rxBytesPerSecond: number;
    txBytesPerSecond: number;
    activeConnections: number;
    droppedPackets?: number;
    errors?: number;
    interfaces?: Array<{
      name: string;
      state: string;
      rxBytesPerSecond: number;
      txBytesPerSecond: number;
      droppedPackets: number;
      errors: number;
    }>;
  };
  pm2: Pm2Metric[];
  topProcesses?: { cpu: OsProcessMetric[]; memory: OsProcessMetric[] };
};

export type OverviewData = {
  logsLast24Hours: number;
  errorsLast24Hours: number;
  errorRate: number;
  services: ServiceSummary[];
  metrics: MetricSnapshot | null;
  metricsStale: boolean;
};
