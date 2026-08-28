import { randomUUID } from "node:crypto";
import { LOG_EVENT_SERVICES } from "@contract/project-registry";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  getLatestMetricSnapshot,
  getObservedPm2Names,
  getPm2RestartBaseline,
} from "@/lib/server/metrics/metrics-store";
import { effectiveRule, listAlertRules } from "@/lib/server/alerts/alert-rules";
import {
  ALERT_RULE_LABELS,
  type AlertCondition,
  type AlertRule,
  type AlertRuleKey,
} from "@/lib/server/alerts/alert-types";

type ServiceSignal = {
  service: string;
  errorWindowHttpCount: number;
  latencyWindowHttpCount: number;
  http5xxCount: number;
  applicationErrors: number;
  latencyP95Ms: number | null;
  lastSeenAt: Date | string | null;
};

function percent(used?: number, total?: number): number | null {
  return total && used !== undefined ? (used / total) * 100 : null;
}

export function buildAlertCondition(
  rule: AlertRule,
  value: number | null,
  eligible: boolean,
  summary: string,
): AlertCondition {
  return {
    ruleKey: rule.ruleKey,
    target: rule.target === "*" ? "" : rule.target,
    active: eligible && value !== null && value >= rule.threshold,
    eligible,
    summary,
    value,
  };
}

export function restartIncrease(
  current: number | null,
  baseline: number | null,
): number | null {
  if (current === null || baseline === null) return null;
  return Math.max(0, current - baseline);
}

async function getServiceSignals(
  rules: AlertRule[],
  now: Date,
): Promise<Map<string, ServiceSignal>> {
  const [recentRows, latest] = await Promise.all([
    Promise.all(
      LOG_EVENT_SERVICES.map(async (service) => {
        const errorWindow =
          effectiveRule(rules, "http_5xx_rate", service)?.windowSeconds ?? 300;
        const latencyWindow =
          effectiveRule(rules, "http_p95_latency", service)?.windowSeconds ??
          300;
        const applicationWindow =
          effectiveRule(rules, "application_errors", service)?.windowSeconds ??
          300;
        const result = await getPostgresPool().query<{
          service: string;
          errorWindowHttpCount: string;
          latencyWindowHttpCount: string;
          http5xxCount: string;
          applicationErrors: string;
          latencyP95Ms: number | null;
        }>(
          `SELECT $1::text AS service,
         COUNT(*) FILTER (WHERE kind='http' AND occurred_at >= $5::timestamptz-($2::double precision*INTERVAL '1 second')) AS "errorWindowHttpCount",
         COUNT(*) FILTER (WHERE kind='http' AND occurred_at >= $5::timestamptz-($3::double precision*INTERVAL '1 second')) AS "latencyWindowHttpCount",
         COUNT(*) FILTER (WHERE kind='http' AND http_status_code>=500 AND occurred_at >= $5::timestamptz-($2::double precision*INTERVAL '1 second')) AS "http5xxCount",
         COUNT(*) FILTER (WHERE kind='application' AND level IN ('error','fatal') AND occurred_at >= $5::timestamptz-($4::double precision*INTERVAL '1 second')) AS "applicationErrors",
         percentile_cont(0.95) WITHIN GROUP (ORDER BY http_duration_ms) FILTER (WHERE kind='http' AND occurred_at >= $5::timestamptz-($3::double precision*INTERVAL '1 second')) AS "latencyP95Ms"
         FROM ops.log_events WHERE service=$1 AND occurred_at <= $5::timestamptz AND occurred_at >= $5::timestamptz-(GREATEST($2::double precision,$3::double precision,$4::double precision)*INTERVAL '1 second')`,
          [service, errorWindow, latencyWindow, applicationWindow, now],
        );
        return result.rows[0];
      }),
    ),
    getPostgresPool().query<{ service: string; lastSeenAt: Date | string }>(
      `SELECT DISTINCT ON (service) service, occurred_at AS "lastSeenAt" FROM ops.log_events ORDER BY service, occurred_at DESC`,
    ),
  ]);
  const map = new Map<string, ServiceSignal>();
  for (const service of LOG_EVENT_SERVICES)
    map.set(service, {
      service,
      errorWindowHttpCount: 0,
      latencyWindowHttpCount: 0,
      http5xxCount: 0,
      applicationErrors: 0,
      latencyP95Ms: null,
      lastSeenAt: null,
    });
  for (const row of recentRows) {
    const current = map.get(row.service);
    if (current)
      Object.assign(current, {
        errorWindowHttpCount: Number(row.errorWindowHttpCount),
        latencyWindowHttpCount: Number(row.latencyWindowHttpCount),
        http5xxCount: Number(row.http5xxCount),
        applicationErrors: Number(row.applicationErrors),
        latencyP95Ms:
          row.latencyP95Ms === null ? null : Number(row.latencyP95Ms),
      });
  }
  for (const row of latest.rows) {
    const current = map.get(row.service);
    if (current) current.lastSeenAt = row.lastSeenAt;
  }
  return map;
}

export async function collectAlertConditions(
  now = new Date(),
): Promise<Array<{ rule: AlertRule; condition: AlertCondition }>> {
  const rules = await listAlertRules();
  const [signals, metrics, observedPm2] = await Promise.all([
    getServiceSignals(rules, now),
    getLatestMetricSnapshot(),
    getObservedPm2Names(),
  ]);
  const output: Array<{ rule: AlertRule; condition: AlertCondition }> = [];
  const serviceKeys: AlertRuleKey[] = [
    "http_5xx_rate",
    "http_p95_latency",
    "application_errors",
    "service_silence",
    "pm2_process_down",
    "pm2_restart_loop",
  ];
  const restartBaselines = new Map<string, number | null>(
    await Promise.all(
      LOG_EVENT_SERVICES.map(async (service) => {
        const windowSeconds =
          effectiveRule(rules, "pm2_restart_loop", service)?.windowSeconds ??
          300;
        return [
          service,
          await getPm2RestartBaseline(
            service,
            new Date(now.getTime() - windowSeconds * 1_000),
          ),
        ] as const;
      }),
    ),
  );
  for (const [service, signal] of signals) {
    for (const key of serviceKeys) {
      const base = effectiveRule(rules, key, service);
      if (!base) continue;
      const rule = { ...base, target: service };
      let value: number | null = null;
      let eligible = true;
      if (key === "http_5xx_rate") {
        value = signal.errorWindowHttpCount
          ? (signal.http5xxCount / signal.errorWindowHttpCount) * 100
          : 0;
        eligible = signal.errorWindowHttpCount >= rule.minimumCount;
      }
      if (key === "http_p95_latency") {
        value = signal.latencyP95Ms;
        eligible =
          signal.latencyWindowHttpCount >= rule.minimumCount && value !== null;
      }
      if (key === "application_errors") value = signal.applicationErrors;
      if (key === "service_silence") {
        eligible = signal.lastSeenAt !== null;
        value = signal.lastSeenAt
          ? (now.getTime() - new Date(signal.lastSeenAt).getTime()) / 1000
          : null;
      }
      if (key === "pm2_process_down") {
        eligible = observedPm2.has(service);
        const process = metrics?.pm2.find((item) => item.name === service);
        value = !process || process.status !== "online" ? 1 : 0;
      }
      if (key === "pm2_restart_loop") {
        const process = metrics?.pm2.find((item) => item.name === service);
        value = restartIncrease(
          process?.restartCount ?? null,
          restartBaselines.get(service) ?? null,
        );
        eligible = observedPm2.has(service) && value !== null;
      }
      output.push({
        rule,
        condition: buildAlertCondition(
          rule,
          value,
          eligible,
          `${ALERT_RULE_LABELS[key]} threshold exceeded for ${service}`,
        ),
      });
    }
  }
  const hostValues: Record<string, number | null> = {
    host_cpu: metrics?.cpu.usagePercent ?? null,
    host_memory: metrics
      ? (metrics.memory.pressurePercent ??
        percent(metrics.memory.usedBytes, metrics.memory.totalBytes))
      : null,
    host_disk: metrics
      ? percent(metrics.disk.usedBytes, metrics.disk.totalBytes)
      : null,
    metrics_stale: metrics
      ? (now.getTime() - new Date(metrics.measuredAt).getTime()) / 1000
      : (effectiveRule(rules, "metrics_stale", "host")?.threshold ?? 90) + 1,
  };
  for (const key of [
    "host_cpu",
    "host_memory",
    "host_disk",
    "metrics_stale",
  ] as const) {
    const rule = effectiveRule(rules, key, "host");
    if (rule)
      output.push({
        rule,
        condition: buildAlertCondition(
          rule,
          hostValues[key],
          true,
          `${ALERT_RULE_LABELS[key]} threshold exceeded`,
        ),
      });
  }
  return output;
}

async function queueNotification(
  client: import("pg").PoolClient,
  alertId: string,
  kind: "firing" | "reminder" | "recovery",
): Promise<void> {
  await client.query(
    `INSERT INTO ops.alert_notifications (id,alert_id,kind) VALUES ($1,$2,$3)`,
    [randomUUID(), alertId, kind],
  );
  await client.query(
    `UPDATE ops.alert_instances SET last_notification_at=NOW() WHERE id=$1`,
    [alertId],
  );
}

async function applyCondition(
  rule: AlertRule,
  item: AlertCondition,
  now: Date,
): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      status: "pending" | "firing";
      pendingSince: Date | string;
      lastNotificationAt: Date | string | null;
    }>(
      `SELECT a.id,a.status,a.pending_since AS "pendingSince",a.last_notification_at AS "lastNotificationAt"
       FROM ops.alert_instances a WHERE rule_key=$1 AND target=$2 AND status IN ('pending','firing') FOR UPDATE`,
      [rule.ruleKey, item.target],
    );
    const current = result.rows[0];
    const muteResult = await client.query<{
      expiresAt: Date | string | null;
    }>(
      `SELECT expires_at AS "expiresAt" FROM ops.alert_mutes WHERE target=$1 FOR UPDATE`,
      [item.target],
    );
    const mute = muteResult.rows[0];
    const muteActive = Boolean(
      mute &&
      (mute.expiresAt === null ||
        new Date(mute.expiresAt).getTime() > now.getTime()),
    );
    const muteJustExpired = Boolean(mute && !muteActive);
    if (muteJustExpired)
      await client.query(`DELETE FROM ops.alert_mutes WHERE target=$1`, [
        item.target,
      ]);
    if (!rule.enabled || !item.eligible || !item.active) {
      if (current) {
        const wasFiring = current.status === "firing";
        await client.query(
          `UPDATE ops.alert_instances SET status='resolved',resolved_at=$2,resolution_reason=$3,last_evaluated_at=$2,updated_at=$2 WHERE id=$1`,
          [
            current.id,
            now,
            rule.enabled ? "condition recovered" : "rule disabled",
          ],
        );
        await client.query(
          `INSERT INTO ops.alert_transitions (alert_id,transition,reason,occurred_at) VALUES ($1,'resolved',$2,$3)`,
          [
            current.id,
            rule.enabled ? "condition recovered" : "rule disabled",
            now,
          ],
        );
        if (wasFiring) await queueNotification(client, current.id, "recovery");
      }
      await client.query("COMMIT");
      return;
    }
    if (!current) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO ops.alert_instances (id,rule_key,target,severity,status,summary,value,threshold,pending_since,last_evaluated_at) VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$8)`,
        [
          id,
          rule.ruleKey,
          item.target,
          rule.severity,
          item.summary,
          item.value,
          rule.threshold,
          now,
        ],
      );
      await client.query(
        `INSERT INTO ops.alert_transitions (alert_id,transition,occurred_at) VALUES ($1,'pending',$2)`,
        [id, now],
      );
    } else if (
      current.status === "pending" &&
      now.getTime() - new Date(current.pendingSince).getTime() >=
        rule.forSeconds * 1000
    ) {
      await client.query(
        `UPDATE ops.alert_instances SET status='firing',severity=$2,summary=$3,value=$4,threshold=$5,fired_at=$6,last_evaluated_at=$6,updated_at=$6 WHERE id=$1`,
        [
          current.id,
          rule.severity,
          item.summary,
          item.value,
          rule.threshold,
          now,
        ],
      );
      await client.query(
        `INSERT INTO ops.alert_transitions (alert_id,transition,occurred_at) VALUES ($1,'firing',$2)`,
        [current.id, now],
      );
      await queueNotification(client, current.id, "firing");
    } else {
      await client.query(
        `UPDATE ops.alert_instances SET severity=$2,summary=$3,value=$4,threshold=$5,last_evaluated_at=$6,updated_at=$6 WHERE id=$1`,
        [
          current.id,
          rule.severity,
          item.summary,
          item.value,
          rule.threshold,
          now,
        ],
      );
      if (
        current.status === "firing" &&
        !muteActive &&
        (muteJustExpired ||
          !current.lastNotificationAt ||
          now.getTime() - new Date(current.lastNotificationAt).getTime() >=
            rule.reminderSeconds * 1000)
      )
        await queueNotification(client, current.id, "reminder");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function evaluateAlerts(now = new Date()): Promise<void> {
  const pool = getPostgresPool();
  const lock = await pool.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(67492031) AS locked`,
  );
  if (!lock.rows[0]?.locked) return;
  try {
    for (const item of await collectAlertConditions(now))
      await applyCondition(item.rule, item.condition, now);
  } finally {
    await pool.query(`SELECT pg_advisory_unlock(67492031)`);
  }
}
