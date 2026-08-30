import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/server/postgres", () => ({
  getPostgresPool: () => ({ query }),
}));

import {
  deleteExpiredSecurityEvents,
  getSecurityEvents,
  getSecurityStats,
  insertSecurityEvent,
  isFirstSeenSourceIp,
} from "@/lib/server/security/security-repository";
import type { SecurityEvent } from "@/types/security";

const sampleEvent: SecurityEvent = {
  eventId: "sec_test_123",
  occurredAt: "2026-08-30T17:00:00.000Z",
  eventType: "login_success",
  account: "cc",
  sourceIp: "172.16.101.50",
  sourcePort: 54321,
  authMethod: "publickey",
  keyType: "ED25519",
  keyFingerprint: "SHA256:lhDoFqdkbJKacLGpoR81qUABw669ilEzThE4OED221c",
  subnetClassification: "Server / Infra Subnet (IITG)",
  reverseDns: "infra-node.iitg.ac.in",
  service: "sshd",
  result: "success",
  summary: "SSH public key login for cc from 172.16.101.50",
};

describe("security repository", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("inserts security event and updates source IP tracking", async () => {
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ event_id: sampleEvent.eventId }],
    });
    query.mockResolvedValueOnce({ rowCount: 1 });

    const inserted = await insertSecurityEvent(sampleEvent);
    expect(inserted).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][0]).toBe(sampleEvent.eventId);
    expect(query.mock.calls[1][1][0]).toBe(sampleEvent.sourceIp);
  });

  it("detects first-seen source IP correctly", async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const isNew = await isFirstSeenSourceIp("172.16.101.99");
    expect(isNew).toBe(true);

    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ first_seen_at: "2026-08-01" }],
    });
    const isOld = await isFirstSeenSourceIp("172.16.101.50");
    expect(isOld).toBe(false);
  });

  it("does not update source IP counters for duplicate deliveries", async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const inserted = await insertSecurityEvent(sampleEvent);

    expect(inserted).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("builds parameterized filters for event queries", async () => {
    query.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    query.mockResolvedValueOnce({ rows: [sampleEvent] });

    const result = await getSecurityEvents({
      account: "cc",
      sourceIp: "172.16.101.50",
      eventType: "login_success",
      search: "infra-node",
    });

    expect(result.total).toBe(1);
    expect(result.events.length).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
    const sql = query.mock.calls[1][0];
    expect(sql).toContain("event_type = $1");
    expect(sql).toContain("account = $2");
    expect(sql).toContain("host(source_ip) = $3");
    expect(sql).toContain("search_vector @@ plainto_tsquery('simple', $4)");
  });

  it("computes stats and collector freshness", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { logins24h: "5", uniqueIps24h: "2", failed24h: "1", sudo24h: "3" },
      ],
    });
    query.mockResolvedValueOnce({
      rows: [{ occurredAt: new Date().toISOString(), queueDepth: 0 }],
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          account: "cc",
          sourceIp: "172.16.101.50",
          subnet: "Server / Infra Subnet (IITG)",
          authMethod: "publickey",
          keyFingerprint: "SHA256:lhDo...",
          occurredAt: new Date().toISOString(),
        },
      ],
    });

    const stats = await getSecurityStats();
    expect(stats.totalLogins24h).toBe(5);
    expect(stats.uniqueIps24h).toBe(2);
    expect(stats.failedLogins24h).toBe(1);
    expect(stats.sudoEscalations24h).toBe(3);
    expect(stats.collectorFreshness).toBe("live");
    expect(stats.recentActiveSessions.length).toBe(1);
  });

  it("deletes expired security events by retention window", async () => {
    query.mockResolvedValueOnce({ rowCount: 42 });
    const deleted = await deleteExpiredSecurityEvents(90);
    expect(deleted).toBe(42);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM ops.security_events"),
      [90],
    );
  });
});
