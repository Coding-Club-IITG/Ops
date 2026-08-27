import { getRuntimeConfig } from "@/lib/server/env";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  ALERT_RULE_LABELS,
  type AlertRuleKey,
} from "@/lib/server/alerts/alert-types";

type Delivery = {
  id: string;
  alertId: string;
  kind: "firing" | "reminder" | "recovery";
  attempts: number;
  ruleKey: AlertRuleKey;
  target: string;
  severity: "warning" | "critical";
  summary: string;
  value: number | null;
  threshold: number | null;
  pendingSince: Date | string;
  firedAt: Date | string | null;
  resolvedAt: Date | string | null;
};

function displayValue(rule: AlertRuleKey, value: number | null): string {
  if (value === null) return "Unavailable";
  if (["http_5xx_rate", "host_cpu", "host_memory", "host_disk"].includes(rule))
    return `${value.toFixed(1)}%`;
  if (rule === "http_p95_latency") return `${Math.round(value)} ms`;
  if (["service_silence", "metrics_stale"].includes(rule))
    return `${Math.round(value)} seconds`;
  return String(Math.round(value));
}

function payload(delivery: Delivery) {
  const config = getRuntimeConfig();
  const titlePrefix =
    delivery.kind === "recovery"
      ? "Recovered"
      : delivery.kind === "reminder"
        ? "Still firing"
        : "Firing";
  const started = new Date(delivery.firedAt ?? delivery.pendingSince);
  const duration = delivery.resolvedAt
    ? Math.max(0, Date.parse(String(delivery.resolvedAt)) - started.getTime())
    : null;
  const fields = [
    { name: "Target", value: delivery.target, inline: true },
    {
      name: "Observed",
      value: displayValue(delivery.ruleKey, delivery.value),
      inline: true,
    },
    {
      name: "Threshold",
      value: displayValue(delivery.ruleKey, delivery.threshold),
      inline: true,
    },
    {
      name: "Started",
      value: `<t:${Math.floor(started.getTime() / 1000)}:R>`,
      inline: true,
    },
  ];
  if (duration !== null)
    fields.push({
      name: "Duration",
      value: `${Math.round(duration / 60_000)} minutes`,
      inline: true,
    });
  return {
    username: "Coding Club Ops",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `${titlePrefix}: ${ALERT_RULE_LABELS[delivery.ruleKey]}`,
        description: delivery.summary,
        url: `${config.BASE_URL}/alerts?target=${encodeURIComponent(delivery.target)}`,
        color:
          delivery.kind === "recovery"
            ? 0x238636
            : delivery.severity === "critical"
              ? 0xda3633
              : 0xd29922,
        fields,
        footer: { text: `Alert ${delivery.alertId}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function claimDelivery(): Promise<Delivery | "skipped" | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Delivery>(
      `SELECT n.id,n.alert_id AS "alertId",n.kind,n.attempts,a.rule_key AS "ruleKey",a.target,a.severity,
       a.summary,a.value,a.threshold,a.pending_since AS "pendingSince",a.fired_at AS "firedAt",a.resolved_at AS "resolvedAt"
       FROM ops.alert_notifications n JOIN ops.alert_instances a ON a.id=n.alert_id
       WHERE n.status IN ('pending','failed') AND n.next_attempt_at <= NOW() AND n.attempts < 5
       ORDER BY n.created_at FOR UPDATE OF n SKIP LOCKED LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const muted = await client.query(
      `SELECT 1 FROM ops.alert_mutes WHERE target=$1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [row.target],
    );
    if (muted.rowCount) {
      await client.query(
        `UPDATE ops.alert_notifications SET status='suppressed',last_error='target muted' WHERE id=$1`,
        [row.id],
      );
      await client.query("COMMIT");
      return "skipped";
    }
    await client.query(
      `UPDATE ops.alert_notifications SET status='sending',attempts=attempts+1 WHERE id=$1`,
      [row.id],
    );
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deliverDiscordNotifications(): Promise<void> {
  const config = getRuntimeConfig();
  for (;;) {
    const delivery = await claimDelivery();
    if (!delivery) return;
    if (delivery === "skipped") continue;
    if (!config.DISCORD_ALERT_WEBHOOK_URL) {
      await fail(delivery, "Discord webhook is not configured", true);
      continue;
    }
    try {
      const response = await fetch(
        `${config.DISCORD_ALERT_WEBHOOK_URL}?wait=true`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload(delivery)),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok)
        throw new Error(`Discord returned HTTP ${response.status}`);
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      await getPostgresPool().query(
        `UPDATE ops.alert_notifications SET status='sent',delivered_at=NOW(),discord_message_id=$2,last_error=NULL WHERE id=$1`,
        [delivery.id, body.id ?? null],
      );
    } catch (error) {
      await fail(
        delivery,
        error instanceof Error ? error.message : "Discord delivery failed",
        false,
      );
    }
  }
}

async function fail(delivery: Delivery, message: string, permanent: boolean) {
  const attempts = delivery.attempts + 1;
  const exhausted = permanent || attempts >= 5;
  const delaySeconds = Math.min(900, 30 * 2 ** Math.max(0, attempts - 1));
  await getPostgresPool().query(
    `UPDATE ops.alert_notifications SET status='failed',last_error=$2,next_attempt_at=CASE WHEN $3 THEN next_attempt_at ELSE NOW()+($4*INTERVAL '1 second') END,attempts=CASE WHEN $3 THEN 5 ELSE attempts END WHERE id=$1`,
    [delivery.id, message.slice(0, 300), exhausted, delaySeconds],
  );
}

export async function sendDiscordTest(): Promise<void> {
  const url = getRuntimeConfig().DISCORD_ALERT_WEBHOOK_URL;
  if (!url) throw new Error("Discord webhook is not configured");
  const response = await fetch(`${url}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "Coding Club Ops",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "Ops alert connection test",
          description: "Discord notifications are configured correctly.",
          color: 0x238636,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}`);
}
