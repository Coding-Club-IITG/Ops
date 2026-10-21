import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startupFailure: new Error("MongoDB unavailable during startup"),
  connect: vi.fn().mockResolvedValue(undefined),
  sendCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/server/postgres-schema", () => ({
  ensurePostgresSchema: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/server/env", () => ({
  getRuntimeConfig: () => ({
    LOG_STREAM_KEY: "test:logs",
    LOG_CONSUMER_GROUP: "test-log-workers",
    METRIC_STREAM_KEY: "test:metrics",
    METRIC_CONSUMER_GROUP: "test-metric-workers",
    SECURITY_STREAM_KEY: "test:security",
    SECURITY_CONSUMER_GROUP: "test-security-workers",
  }),
}));
vi.mock("@/lib/server/redis", () => ({
  createRedisConnection: () => ({
    connect: mocks.connect,
    sendCommand: mocks.sendCommand,
  }),
}));
vi.mock("@/lib/server/metrics/metrics-store", () => ({
  ensureMongoCollections: vi.fn().mockRejectedValue(mocks.startupFailure),
  addMetricSnapshot: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

it("exits after a startup failure even when Redis connections are open", async () => {
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  await import("@/worker/index");

  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  expect(mocks.connect).toHaveBeenCalledTimes(3);
  expect(error).toHaveBeenCalledWith("ops-worker failed", mocks.startupFailure);
});
