import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/lib/server/postgres";
import type { AlertRuleKey } from "@/lib/server/alerts/alert-types";
import type { SecurityEvent } from "@/types/security";

// In-memory alert cooldowns
const ALERT_COOLDOWNS = new Map<string, number>();

function isOnCooldown(key: string, durationSeconds: number): boolean {
  const now = Date.now();
  const last = ALERT_COOLDOWNS.get(key) ?? 0;
  if (now - last < durationSeconds * 1000) {
    return true;
  }
  ALERT_COOLDOWNS.set(key, now);
  return false;
}

async function recordSecurityDetection(input: {
  ruleKey: AlertRuleKey;
  target: string;
  severity: "warning" | "critical";
  summary: string;
  value?: number;
  threshold?: number;
  occurredAt: string;
}): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const alertId = randomUUID();
  const occurredAt = new Date(input.occurredAt);
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ops.alert_instances
       (id,rule_key,target,severity,status,summary,value,threshold,pending_since,
        fired_at,resolved_at,resolution_reason,last_evaluated_at,last_notification_at,updated_at)
       VALUES ($1,$2,$3,$4,'resolved',$5,$6,$7,$8,$8,$8,
        'security event recorded',$8,$8,$8)`,
      [
        alertId,
        input.ruleKey,
        input.target,
        input.severity,
        input.summary,
        input.value ?? null,
        input.threshold ?? null,
        occurredAt,
      ],
    );
    await client.query(
      `INSERT INTO ops.alert_transitions (alert_id,transition,occurred_at)
       VALUES ($1,'firing',$2),($1,'resolved',$2)`,
      [alertId, occurredAt],
    );
    await client.query(
      `INSERT INTO ops.alert_notifications (id,alert_id,kind) VALUES ($1,$2,'firing')`,
      [randomUUID(), alertId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function evaluateSecurityAlert(
  event: SecurityEvent,
  isFirstSeenIp: boolean = false,
): Promise<void> {
  // 1. Successful Login Alert (Only for first-seen new IPs)
  if (event.eventType === "login_success") {
    if (!isFirstSeenIp) {
      // Do not send notifications for routine logins from known IPs
      return;
    }

    await recordSecurityDetection({
      ruleKey: "security_new_source_ip",
      target: event.sourceIp ?? event.eventId,
      severity: "critical",
      summary: `First login from ${event.sourceIp ?? "an unknown IP"} for ${event.account} via ${event.authMethod ?? "unknown authentication"} (${event.subnetClassification ?? "unknown subnet"})`,
      occurredAt: event.occurredAt,
    });
    return;
  }

  // 2. Sudo Escalation Alert
  if (event.eventType === "sudo_escalation") {
    const key = `sudo:${event.account}:${event.command?.slice(0, 30)}`;
    if (isOnCooldown(key, 60)) return; // 1-minute dedup for identical sudo commands

    await recordSecurityDetection({
      ruleKey: "security_sudo_escalation",
      target: event.eventId,
      severity: "warning",
      summary: `${event.account} used sudo as ${event.targetAccount ?? "root"} on ${event.tty ?? "unknown TTY"}: ${event.command ?? "unknown command"}`,
      occurredAt: event.occurredAt,
    });
    return;
  }

  // 3. Failed Login / Brute Force Alert
  if (event.eventType === "login_failure" && event.sourceIp) {
    const cooldownKey = `bruteforce:${event.sourceIp}`;
    const pool = getPostgresPool();
    const countRes = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*) as count FROM ops.security_events
      WHERE event_type = 'login_failure'
        AND host(source_ip) = $1
        AND occurred_at >= NOW() - INTERVAL '10 minutes';
      `,
      [event.sourceIp],
    );

    const failCount = Number(countRes.rows[0]?.count ?? 1);
    if (failCount >= 5) {
      // Apply the cooldown only once the threshold has been reached
      if (isOnCooldown(cooldownKey, 600)) return;
      await recordSecurityDetection({
        ruleKey: "security_brute_force",
        target: event.sourceIp,
        severity: "critical",
        summary: `${failCount} failed SSH logins from ${event.sourceIp} within 10 minutes; latest target account ${event.account}`,
        value: failCount,
        threshold: 5,
        occurredAt: event.occurredAt,
      });
    }
  }
}

export async function checkCollectorDeadman(): Promise<void> {
  const pool = getPostgresPool();

  const hbRes = await pool.query<{ occurredAt: string }>(
    `
    SELECT occurred_at as "occurredAt"
    FROM ops.security_events
    WHERE event_type = 'collector_heartbeat'
    ORDER BY occurred_at DESC
    LIMIT 1;
    `,
  );

  const lastHb = hbRes.rows[0]?.occurredAt ?? null;
  const ageSeconds = lastHb
    ? (Date.now() - new Date(lastHb).getTime()) / 1000
    : null;
  if (ageSeconds === null || ageSeconds > 300) {
    const cooldownKey = "collector:deadman:stale";
    if (isOnCooldown(cooldownKey, 1800)) return; // 30 min reminder

    await recordSecurityDetection({
      ruleKey: "security_collector_stale",
      target: "security-collector",
      severity: "critical",
      summary:
        ageSeconds === null
          ? "The login collector has never emitted a heartbeat"
          : `The login collector heartbeat is ${Math.round(ageSeconds / 60)} minutes stale`,
      value: ageSeconds ?? undefined,
      threshold: 300,
      occurredAt: new Date().toISOString(),
    });
  }
}
