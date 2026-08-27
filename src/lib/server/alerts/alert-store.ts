import { z } from "zod";
import { getPostgresPool } from "@/lib/server/postgres";
import { ALERT_RULE_KEYS } from "@/lib/server/alerts/alert-types";
import { DEFAULT_PAGE_SIZE } from "@/lib/ops-constants";

export const alertQuerySchema = z
  .object({
    status: z.enum(["pending", "firing", "resolved"]).optional(),
    severity: z.enum(["warning", "critical"]).optional(),
    ruleKey: z.enum(ALERT_RULE_KEYS).optional(),
    target: z.string().min(1).max(128).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const alertMuteInputSchema = z
  .object({
    target: z.string().min(1).max(128),
    duration: z.enum(["1h", "4h", "24h", "indefinite"]),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export function parseAlertQuery(url: string) {
  return alertQuerySchema.parse(
    Object.fromEntries(new URL(url).searchParams.entries()),
  );
}

export async function listAlerts(query: z.infer<typeof alertQuerySchema>) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };
  if (query.status) add("status=?", query.status);
  if (query.severity) add("severity=?", query.severity);
  if (query.ruleKey) add("rule_key=?", query.ruleKey);
  if (query.target) add("target=?", query.target);
  if (query.from) add("pending_since>=?", query.from);
  if (query.to) add("pending_since<=?", query.to);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const pool = getPostgresPool();
  const [rows, total, mutes, failures] = await Promise.all([
    pool.query(
      `${`SELECT id,rule_key AS "ruleKey",target,severity,status,summary,value,threshold,
      pending_since AS "pendingSince",fired_at AS "firedAt",resolved_at AS "resolvedAt",
      resolution_reason AS "resolutionReason",last_evaluated_at AS "lastEvaluatedAt",
      last_notification_at AS "lastNotificationAt",
      (SELECT status FROM ops.alert_notifications WHERE alert_id=ops.alert_instances.id ORDER BY created_at DESC LIMIT 1) AS "lastDeliveryStatus"
      FROM ops.alert_instances ${where}
      ORDER BY CASE status WHEN 'firing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`}`,
      [...values, query.limit, query.offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ops.alert_instances ${where}`,
      values,
    ),
    listAlertMutes(),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ops.alert_notifications WHERE status='failed'`,
    ),
  ]);
  return {
    data: rows.rows.map((row) => serializeDates(row)),
    total: Number(total.rows[0]?.count ?? 0),
    mutes,
    failedDeliveries: Number(failures.rows[0]?.count ?? 0),
  };
}

function serializeDates(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

export async function listAlertMutes() {
  const result = await getPostgresPool().query(
    `SELECT target,reason,muted_by AS "mutedBy",muted_at AS "mutedAt",expires_at AS "expiresAt" FROM ops.alert_mutes WHERE expires_at IS NULL OR expires_at > NOW() ORDER BY target`,
  );
  return result.rows.map((row) => serializeDates(row));
}

export async function saveAlertMute(
  input: z.infer<typeof alertMuteInputSchema>,
  actor: string,
) {
  const durationMs = {
    "1h": 3_600_000,
    "4h": 14_400_000,
    "24h": 86_400_000,
    indefinite: null,
  }[input.duration];
  const expiresAt =
    durationMs === null ? null : new Date(Date.now() + durationMs);
  const result = await getPostgresPool().query(
    `INSERT INTO ops.alert_mutes (target,reason,muted_by,expires_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (target) DO UPDATE SET reason=EXCLUDED.reason,muted_by=EXCLUDED.muted_by,muted_at=NOW(),expires_at=EXCLUDED.expires_at
     RETURNING target,reason,muted_by AS "mutedBy",muted_at AS "mutedAt",expires_at AS "expiresAt"`,
    [input.target, input.reason, actor, expiresAt],
  );
  return serializeDates(result.rows[0]);
}

export async function removeAlertMute(target: string): Promise<boolean> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const removed = await client.query(
      `DELETE FROM ops.alert_mutes WHERE target=$1`,
      [target],
    );
    if (removed.rowCount)
      await client.query(
        `UPDATE ops.alert_instances SET last_notification_at=NULL WHERE target=$1 AND status='firing'`,
        [target],
      );
    await client.query("COMMIT");
    return removed.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteExpiredAlertHistory(
  retentionDays: number,
): Promise<number> {
  const result = await getPostgresPool().query(
    `DELETE FROM ops.alert_instances WHERE status='resolved' AND resolved_at < NOW() - ($1 * INTERVAL '1 day')`,
    [retentionDays],
  );
  return result.rowCount ?? 0;
}
