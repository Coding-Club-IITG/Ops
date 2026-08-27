import { z } from "zod";
import { randomUUID } from "node:crypto";
import { LOG_EVENT_SERVICES } from "@contracts/log-event-v1/project-registry";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  ALERT_RULE_KEYS,
  DEFAULT_ALERT_RULES,
  type AlertRule,
  type AlertRuleKey,
} from "@/lib/server/alerts/alert-types";

const serviceRuleKeys = new Set<AlertRuleKey>([
  "http_5xx_rate",
  "http_p95_latency",
  "application_errors",
  "service_silence",
  "pm2_process_down",
]);

export const alertRuleInputSchema = z
  .object({
    ruleKey: z.enum(ALERT_RULE_KEYS),
    target: z.string().min(1).max(128),
    enabled: z.boolean(),
    severity: z.enum(["warning", "critical"]),
    threshold: z.number().min(0),
    windowSeconds: z.number().int().min(30).max(86_400),
    forSeconds: z.number().int().min(30).max(3_600),
    reminderSeconds: z.number().int().min(300).max(86_400),
    minimumCount: z.number().int().min(0).max(1_000_000),
  })
  .strict()
  .superRefine((input, context) => {
    const serviceRule = serviceRuleKeys.has(input.ruleKey);
    const validServiceTarget =
      input.target === "*" ||
      (LOG_EVENT_SERVICES as readonly string[]).includes(input.target);
    if (
      (serviceRule && !validServiceTarget) ||
      (!serviceRule && input.target !== "host")
    )
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: "Target is invalid for this rule",
      });
  });

type RuleRow = {
  ruleKey: AlertRuleKey;
  target: string;
  enabled: boolean;
  severity: "warning" | "critical";
  threshold: number;
  windowSeconds: number;
  forSeconds: number;
  reminderSeconds: number;
  minimumCount: number;
  updatedBy: string;
  updatedAt: Date | string;
};

function mapRule(row: RuleRow): AlertRule {
  return {
    ...row,
    threshold: Number(row.threshold),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function ensureDefaultAlertRules(): Promise<void> {
  const pool = getPostgresPool();
  for (const rule of DEFAULT_ALERT_RULES) {
    await pool.query(
      `INSERT INTO ops.alert_rules
       (rule_key, target, enabled, severity, threshold, window_seconds, for_seconds, reminder_seconds, minimum_count, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'system') ON CONFLICT (rule_key, target) DO NOTHING`,
      [
        rule.ruleKey,
        rule.target,
        rule.enabled,
        rule.severity,
        rule.threshold,
        rule.windowSeconds,
        rule.forSeconds,
        rule.reminderSeconds,
        rule.minimumCount,
      ],
    );
  }
}

export async function listAlertRules(): Promise<AlertRule[]> {
  const result = await getPostgresPool().query<RuleRow>(
    `SELECT rule_key AS "ruleKey", target, enabled, severity, threshold,
      window_seconds AS "windowSeconds", for_seconds AS "forSeconds",
      reminder_seconds AS "reminderSeconds", minimum_count AS "minimumCount",
      updated_by AS "updatedBy", updated_at AS "updatedAt"
     FROM ops.alert_rules ORDER BY target, rule_key`,
  );
  return result.rows.map(mapRule);
}

export async function saveAlertRule(
  input: z.infer<typeof alertRuleInputSchema>,
  actor: string,
): Promise<AlertRule> {
  const result = await getPostgresPool().query<RuleRow>(
    `INSERT INTO ops.alert_rules
      (rule_key,target,enabled,severity,threshold,window_seconds,for_seconds,reminder_seconds,minimum_count,updated_by,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (rule_key,target) DO UPDATE SET enabled=EXCLUDED.enabled,severity=EXCLUDED.severity,
      threshold=EXCLUDED.threshold,window_seconds=EXCLUDED.window_seconds,for_seconds=EXCLUDED.for_seconds,
      reminder_seconds=EXCLUDED.reminder_seconds,minimum_count=EXCLUDED.minimum_count,updated_by=EXCLUDED.updated_by,updated_at=NOW()
     RETURNING rule_key AS "ruleKey",target,enabled,severity,threshold,window_seconds AS "windowSeconds",
      for_seconds AS "forSeconds",reminder_seconds AS "reminderSeconds",minimum_count AS "minimumCount",
      updated_by AS "updatedBy",updated_at AS "updatedAt"`,
    [
      input.ruleKey,
      input.target,
      input.enabled,
      input.severity,
      input.threshold,
      input.windowSeconds,
      input.forSeconds,
      input.reminderSeconds,
      input.minimumCount,
      actor,
    ],
  );
  await resolveRuleAfterConfigurationChange(input.ruleKey, input.target);
  return mapRule(result.rows[0]);
}

export async function deleteAlertRuleOverride(
  ruleKey: AlertRuleKey,
  target: string,
): Promise<boolean> {
  if (target === "*" || target === "host") return false;
  await resolveRuleAfterConfigurationChange(ruleKey, target);
  return (
    (
      await getPostgresPool().query(
        `DELETE FROM ops.alert_rules WHERE rule_key=$1 AND target=$2`,
        [ruleKey, target],
      )
    ).rowCount === 1
  );
}

async function resolveRuleAfterConfigurationChange(
  ruleKey: AlertRuleKey,
  target: string,
): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      status: "pending" | "firing";
    }>(
      `SELECT id,status FROM ops.alert_instances WHERE rule_key=$1 AND ($2='*' OR target=$2)
       AND status IN ('pending','firing') FOR UPDATE`,
      [ruleKey, target],
    );
    for (const row of result.rows) {
      await client.query(
        `UPDATE ops.alert_instances SET status='resolved',resolved_at=NOW(),resolution_reason='rule configuration changed',updated_at=NOW() WHERE id=$1`,
        [row.id],
      );
      await client.query(
        `INSERT INTO ops.alert_transitions (alert_id,transition,reason) VALUES ($1,'resolved','rule configuration changed')`,
        [row.id],
      );
      if (row.status === "firing")
        await client.query(
          `INSERT INTO ops.alert_notifications (id,alert_id,kind) VALUES ($1,$2,'recovery')`,
          [randomUUID(), row.id],
        );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function effectiveRule(
  rules: AlertRule[],
  ruleKey: AlertRuleKey,
  target: string,
): AlertRule | undefined {
  return (
    rules.find((rule) => rule.ruleKey === ruleKey && rule.target === target) ??
    rules.find((rule) => rule.ruleKey === ruleKey && rule.target === "*")
  );
}
