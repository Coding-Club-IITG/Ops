import { beforeEach, describe, expect, it, vi } from "vitest";

const { xAdd } = vi.hoisted(() => ({ xAdd: vi.fn() }));
const { multi } = vi.hoisted(() => ({
  multi: vi.fn(() => ({
    xAdd,
    exec: vi.fn().mockResolvedValue(["1-0"]),
  })),
}));

vi.mock("@/lib/server/env", () => ({
  getRuntimeConfig: () => ({
    SECURITY_INGEST_SECRET: "test-security-ingestion-secret-123456",
    SECURITY_STREAM_KEY: "ops:security:test",
  }),
}));

vi.mock("@/lib/server/redis", () => ({
  getWebRedis: async () => ({ multi }),
}));

import { POST } from "@/app/api/ingest/security/route";

const validBatch = {
  schemaVersion: 1,
  events: [
    {
      eventId: "sec_1234567890abcdef12345678",
      eventType: "login_success",
      occurredAt: "2026-08-30T17:00:00.000Z",
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
    },
  ],
};

function request(
  body: unknown,
  secret = "test-security-ingestion-secret-123456",
) {
  return new Request("http://ops.test/api/ingest/security", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("security ingestion route", () => {
  beforeEach(() => {
    xAdd.mockReset();
    multi.mockClear();
  });

  it("authenticates and enqueues valid batch of security events", async () => {
    const response = await POST(request(validBatch));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({
      accepted: 1,
      eventIds: ["sec_1234567890abcdef12345678"],
    });
    expect(xAdd).toHaveBeenCalledWith("ops:security:test", "*", {
      event: JSON.stringify(validBatch.events[0]),
    });
  });

  it("rejects invalid bearer secret with 401", async () => {
    const response = await POST(
      request(validBatch, "wrong-secret-value-1234567890123456"),
    );
    expect(response.status).toBe(401);
    expect(multi).not.toHaveBeenCalled();
  });

  it("rejects empty or malformed payload with 400", async () => {
    const response = await POST(request({ schemaVersion: 1, events: [] }));
    expect(response.status).toBe(400);
    expect(multi).not.toHaveBeenCalled();
  });

  it("rejects missing required event fields with 400", async () => {
    const response = await POST(
      request({
        schemaVersion: 1,
        events: [{ eventId: "incomplete" }],
      }),
    );
    expect(response.status).toBe(400);
    expect(multi).not.toHaveBeenCalled();
  });

  it("accepts collector heartbeat metadata", async () => {
    const heartbeat = {
      schemaVersion: 1,
      events: [
        {
          eventId: "sec_heartbeat_1234567890",
          eventType: "collector_heartbeat",
          occurredAt: "2026-08-30T17:00:00.000Z",
          account: "system",
          service: "ops-login-collector",
          queueDepth: 0,
          rawMetadata: { hostname: "prod", bootId: "boot-123" },
          result: "success",
          summary: "Collector heartbeat",
        },
      ],
    };
    const response = await POST(request(heartbeat));
    expect(response.status).toBe(202);
  });
});
