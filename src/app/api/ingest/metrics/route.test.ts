import { beforeEach, describe, expect, it, vi } from "vitest";

const { xAdd } = vi.hoisted(() => ({ xAdd: vi.fn() }));
vi.mock("@/lib/server/env", () => ({
  getRuntimeConfig: () => ({
    LOG_INGEST_SECRET: "test-metric-ingestion-secret-123456",
    METRIC_STREAM_KEY: "ops:project-metrics:test",
  }),
}));
vi.mock("@/lib/server/redis", () => ({
  getWebRedis: async () => ({ xAdd }),
}));

import { POST } from "@/app/api/ingest/metrics/route";

const validEvent = {
  schemaVersion: 1,
  eventId: "unknown-metric-1",
  timestamp: "2026-08-28T12:00:00.000Z",
  project: "coursehub",
  service: "coursehub-backend",
  name: "previously.unknown.metric",
  value: 3,
  dimensions: { arbitraryKey: "new-value", studentYear: 2 },
};

function request(
  body: unknown,
  secret = "test-metric-ingestion-secret-123456",
) {
  return new Request("http://ops.test/api/ingest/metrics", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("metric ingestion route", () => {
  beforeEach(() => xAdd.mockReset().mockResolvedValue("1-0"));

  it("authenticates and enqueues a previously unknown metric unchanged", async () => {
    const response = await POST(request(validEvent));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: true,
      eventId: validEvent.eventId,
    });
    expect(xAdd).toHaveBeenCalledWith("ops:project-metrics:test", "*", {
      event: JSON.stringify(validEvent),
    });
  });

  it("rejects invalid credentials before touching Redis", async () => {
    const response = await POST(request(validEvent, "wrong-secret"));
    expect(response.status).toBe(401);
    expect(xAdd).not.toHaveBeenCalled();
  });

  it("rejects credential dimensions", async () => {
    const response = await POST(
      request({ ...validEvent, dimensions: { accessToken: "credential" } }),
    );
    expect(response.status).toBe(400);
    expect(xAdd).not.toHaveBeenCalled();
  });
});
