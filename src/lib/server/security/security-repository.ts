import { getPostgresPool } from "@/lib/server/postgres";
import type {
  SecurityEvent,
  SecurityQueryFilters,
  SecurityStats,
} from "@/types/security";

export async function insertSecurityEvent(
  event: SecurityEvent,
): Promise<boolean> {
  const pool = getPostgresPool();
  const res = await pool.query(
    `
    INSERT INTO ops.security_events (
      event_id, occurred_at, event_type, account, source_ip, source_port,
      auth_method, key_type, key_fingerprint, subnet_classification, reverse_dns,
      service, tty, working_directory, command, target_account, actor,
      queue_depth, result, summary, raw_metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17,
      $18, $19, $20, $21
    ) ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id;
    `,
    [
      event.eventId,
      event.occurredAt,
      event.eventType,
      event.account,
      event.sourceIp ?? null,
      event.sourcePort ?? null,
      event.authMethod ?? null,
      event.keyType ?? null,
      event.keyFingerprint ?? null,
      event.subnetClassification ?? null,
      event.reverseDns ?? null,
      event.service ?? null,
      event.tty ?? null,
      event.workingDirectory ?? null,
      event.command ?? null,
      event.targetAccount ?? null,
      event.actor ?? null,
      event.queueDepth ?? null,
      event.result,
      event.summary,
      JSON.stringify(event.rawMetadata ?? {}),
    ],
  );

  // Redis delivery is at least once. Do not update derived profiles when the
  // event itself was already committed by an earlier delivery.
  if ((res.rowCount ?? 0) === 0) return false;

  // Update source IP tracking profile
  if (
    event.sourceIp &&
    (event.eventType === "login_success" || event.eventType === "login_failure")
  ) {
    const isSuccess = event.eventType === "login_success";
    await pool.query(
      `
      INSERT INTO ops.security_source_ips (
        source_ip, first_seen_at, last_seen_at, last_account,
        subnet_classification, reverse_dns, success_count, failure_count
      ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (source_ip) DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at,
        last_account = EXCLUDED.last_account,
        subnet_classification = COALESCE(EXCLUDED.subnet_classification, ops.security_source_ips.subnet_classification),
        reverse_dns = COALESCE(EXCLUDED.reverse_dns, ops.security_source_ips.reverse_dns),
        success_count = ops.security_source_ips.success_count + EXCLUDED.success_count,
        failure_count = ops.security_source_ips.failure_count + EXCLUDED.failure_count;
      `,
      [
        event.sourceIp,
        event.occurredAt,
        event.account,
        event.subnetClassification ?? null,
        event.reverseDns ?? null,
        isSuccess ? 1 : 0,
        isSuccess ? 0 : 1,
      ],
    );
  }

  return true;
}

export async function isFirstSeenSourceIp(sourceIp: string): Promise<boolean> {
  const pool = getPostgresPool();
  const res = await pool.query(
    `SELECT first_seen_at FROM ops.security_source_ips WHERE source_ip = $1`,
    [sourceIp],
  );
  return (res.rowCount ?? 0) === 0;
}

export async function getSecurityEvents(
  filters: SecurityQueryFilters,
): Promise<{ events: SecurityEvent[]; total: number }> {
  const pool = getPostgresPool();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.from) {
    params.push(filters.from);
    clauses.push(`occurred_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`occurred_at <= $${params.length}`);
  }
  if (filters.eventType) {
    params.push(filters.eventType);
    clauses.push(`event_type = $${params.length}`);
  }
  if (filters.account) {
    params.push(filters.account);
    clauses.push(`account = $${params.length}`);
  }
  if (filters.sourceIp) {
    params.push(filters.sourceIp);
    clauses.push(`host(source_ip) = $${params.length}`);
  }
  if (filters.result) {
    params.push(filters.result);
    clauses.push(`result = $${params.length}`);
  }
  if (filters.search) {
    params.push(filters.search.trim());
    clauses.push(
      `search_vector @@ plainto_tsquery('simple', $${params.length})`,
    );
  }

  const whereClause =
    clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM ops.security_events ${whereClause}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);

  params.push(limit, offset);
  const dataResult = await pool.query(
    `
    SELECT
      event_id as "eventId",
      occurred_at as "occurredAt",
      ingested_at as "ingestedAt",
      event_type as "eventType",
      account,
      host(source_ip) as "sourceIp",
      source_port as "sourcePort",
      auth_method as "authMethod",
      key_type as "keyType",
      key_fingerprint as "keyFingerprint",
      subnet_classification as "subnetClassification",
      reverse_dns as "reverseDns",
      service,
      tty,
      working_directory as "workingDirectory",
      command,
      target_account as "targetAccount",
      actor,
      queue_depth as "queueDepth",
      result,
      summary,
      raw_metadata as "rawMetadata"
    FROM ops.security_events
    ${whereClause}
    ORDER BY occurred_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  return {
    events: dataResult.rows as SecurityEvent[],
    total,
  };
}

export async function getSecurityStats(): Promise<SecurityStats> {
  const pool = getPostgresPool();

  const [metrics24h, heartbeatRes, sessionsRes] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'login_success') as "logins24h",
        COUNT(DISTINCT host(source_ip)) FILTER (WHERE event_type = 'login_success') as "uniqueIps24h",
        COUNT(*) FILTER (WHERE event_type = 'login_failure') as "failed24h",
        COUNT(*) FILTER (WHERE event_type = 'sudo_escalation') as "sudo24h"
      FROM ops.security_events
      WHERE occurred_at >= NOW() - INTERVAL '24 hours';
    `),
    pool.query(`
      SELECT occurred_at as "occurredAt", queue_depth as "queueDepth"
      FROM ops.security_events
      WHERE event_type = 'collector_heartbeat'
      ORDER BY occurred_at DESC
      LIMIT 1;
    `),
    pool.query(`
      SELECT
        account,
        host(source_ip) as "sourceIp",
        subnet_classification as "subnet",
        auth_method as "authMethod",
        key_fingerprint as "keyFingerprint",
        occurred_at as "occurredAt"
      FROM ops.security_events
      WHERE event_type = 'login_success'
      ORDER BY occurred_at DESC
      LIMIT 5;
    `),
  ]);

  const statsRow = metrics24h.rows[0] ?? {};
  const hbRow = heartbeatRes.rows[0];

  let freshness: SecurityStats["collectorFreshness"] = "offline";
  let lastHeartbeatAt: string | null = null;
  let queueDepth = 0;

  if (hbRow) {
    lastHeartbeatAt = new Date(hbRow.occurredAt).toISOString();
    queueDepth = Number(hbRow.queueDepth ?? 0);
    const ageSeconds =
      (Date.now() - new Date(hbRow.occurredAt).getTime()) / 1000;
    if (ageSeconds <= 90) {
      freshness = "live";
    } else if (ageSeconds <= 300) {
      freshness = "lagging";
    } else {
      freshness = "stale";
    }
  }

  return {
    totalLogins24h: Number(statsRow.logins24h ?? 0),
    uniqueIps24h: Number(statsRow.uniqueIps24h ?? 0),
    failedLogins24h: Number(statsRow.failed24h ?? 0),
    sudoEscalations24h: Number(statsRow.sudo24h ?? 0),
    collectorFreshness: freshness,
    lastHeartbeatAt,
    queueDepth,
    recentActiveSessions: sessionsRes.rows.map((r) => ({
      account: String(r.account),
      sourceIp: r.sourceIp ? String(r.sourceIp) : null,
      subnet: r.subnet ? String(r.subnet) : null,
      authMethod: r.authMethod ? String(r.authMethod) : null,
      keyFingerprint: r.keyFingerprint ? String(r.keyFingerprint) : null,
      occurredAt: new Date(r.occurredAt).toISOString(),
    })),
  };
}

export async function deleteExpiredSecurityEvents(
  retentionDays: number,
): Promise<number> {
  const pool = getPostgresPool();
  const res = await pool.query(
    `DELETE FROM ops.security_events WHERE occurred_at < NOW() - ($1 * INTERVAL '1 day');`,
    [retentionDays],
  );
  return res.rowCount ?? 0;
}

export async function storeSecurityDeadLetter(data: {
  streamId: string;
  payloadHash: string;
  failureCode: string;
  validationIssues: Array<{ path: string; message: string }>;
  deliveryCount: number;
}): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `
    INSERT INTO ops.security_dead_letters (
      stream_id, payload_sha256, failure_code, validation_issues, delivery_count
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (stream_id) DO NOTHING;
    `,
    [
      data.streamId,
      data.payloadHash,
      data.failureCode,
      JSON.stringify(data.validationIssues),
      data.deliveryCount,
    ],
  );
}
