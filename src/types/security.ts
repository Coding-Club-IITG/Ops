export type SecurityEventType =
  | "login_success"
  | "login_failure"
  | "session_opened"
  | "session_closed"
  | "sudo_escalation"
  | "collector_heartbeat";

export interface SecurityEvent {
  eventId: string;
  occurredAt: string;
  ingestedAt?: string;
  eventType: SecurityEventType;
  account: string;
  sourceIp?: string;
  sourcePort?: number;
  authMethod?: string;
  keyType?: string;
  keyFingerprint?: string;
  subnetClassification?: string;
  reverseDns?: string;
  service?: string;
  tty?: string;
  workingDirectory?: string;
  command?: string;
  targetAccount?: string;
  actor?: string;
  queueDepth?: number;
  result: "success" | "failure";
  summary: string;
  rawMetadata?: Record<string, unknown>;
}

export interface SecurityQueryFilters {
  from?: string;
  to?: string;
  eventType?: SecurityEventType;
  account?: string;
  sourceIp?: string;
  result?: "success" | "failure";
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SecurityStats {
  totalLogins24h: number;
  uniqueIps24h: number;
  failedLogins24h: number;
  sudoEscalations24h: number;
  collectorFreshness: "live" | "lagging" | "stale" | "offline";
  lastHeartbeatAt: string | null;
  queueDepth: number;
  recentActiveSessions: Array<{
    account: string;
    sourceIp: string | null;
    subnet: string | null;
    authMethod: string | null;
    keyFingerprint: string | null;
    occurredAt: string;
  }>;
}
