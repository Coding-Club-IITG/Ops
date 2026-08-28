export const ALERT_RULE_KEYS = [
  "http_5xx_rate",
  "http_p95_latency",
  "application_errors",
  "service_silence",
  "pm2_process_down",
  "pm2_restart_loop",
  "host_cpu",
  "host_memory",
  "host_disk",
  "metrics_stale",
] as const;

export type AlertRuleKey = (typeof ALERT_RULE_KEYS)[number];
export type AlertSeverity = "warning" | "critical";
export type AlertStatus = "pending" | "firing" | "resolved";
export type AlertNotificationKind = "firing" | "reminder" | "recovery";

export type AlertRule = {
  ruleKey: AlertRuleKey;
  target: string;
  enabled: boolean;
  severity: AlertSeverity;
  threshold: number;
  windowSeconds: number;
  forSeconds: number;
  reminderSeconds: number;
  minimumCount: number;
  updatedBy: string;
  updatedAt: string;
};

export type AlertCondition = {
  ruleKey: AlertRuleKey;
  target: string;
  active: boolean;
  eligible: boolean;
  summary: string;
  value: number | null;
};

export const DEFAULT_ALERT_RULES: ReadonlyArray<
  Omit<AlertRule, "updatedBy" | "updatedAt">
> = [
  {
    ruleKey: "http_5xx_rate",
    target: "*",
    enabled: true,
    severity: "warning",
    threshold: 5,
    windowSeconds: 300,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 20,
  },
  {
    ruleKey: "http_p95_latency",
    target: "*",
    enabled: true,
    severity: "warning",
    threshold: 2000,
    windowSeconds: 300,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 20,
  },
  {
    ruleKey: "application_errors",
    target: "*",
    enabled: true,
    severity: "warning",
    threshold: 5,
    windowSeconds: 300,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 0,
  },
  {
    ruleKey: "service_silence",
    target: "*",
    enabled: false,
    severity: "warning",
    threshold: 600,
    windowSeconds: 600,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 0,
  },
  {
    ruleKey: "pm2_process_down",
    target: "*",
    enabled: true,
    severity: "critical",
    threshold: 1,
    windowSeconds: 120,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 0,
  },
  {
    ruleKey: "pm2_restart_loop",
    target: "*",
    enabled: true,
    severity: "critical",
    threshold: 3,
    windowSeconds: 300,
    forSeconds: 30,
    reminderSeconds: 3600,
    minimumCount: 0,
  },
  {
    ruleKey: "host_cpu",
    target: "host",
    enabled: true,
    severity: "critical",
    threshold: 90,
    windowSeconds: 120,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 0,
  },
  {
    ruleKey: "host_memory",
    target: "host",
    enabled: true,
    severity: "critical",
    threshold: 90,
    windowSeconds: 120,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 0,
  },
  {
    ruleKey: "host_disk",
    target: "host",
    enabled: true,
    severity: "critical",
    threshold: 95,
    windowSeconds: 120,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 0,
  },
  {
    ruleKey: "metrics_stale",
    target: "host",
    enabled: true,
    severity: "critical",
    threshold: 90,
    windowSeconds: 90,
    forSeconds: 120,
    reminderSeconds: 3600,
    minimumCount: 0,
  },
];

export const ALERT_RULE_LABELS: Record<AlertRuleKey, string> = {
  http_5xx_rate: "HTTP 5xx rate",
  http_p95_latency: "HTTP p95 latency",
  application_errors: "Application errors",
  service_silence: "Service silence",
  pm2_process_down: "PM2 process down",
  pm2_restart_loop: "PM2 restart loop",
  host_cpu: "Host CPU",
  host_memory: "Host memory",
  host_disk: "Host disk",
  metrics_stale: "Metrics stale",
};
