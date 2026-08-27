import { describe, expect, it } from "vitest";
import { evaluateHostHealth } from "@/lib/server/metrics/host-health";
import type { MetricSnapshot } from "@/lib/server/metrics/metrics-types";

function snapshot(
  overrides: {
    cpu?: number;
    memory?: number;
    disk?: number;
    measuredAt?: Date;
  } = {},
): MetricSnapshot {
  return {
    measuredAt: overrides.measuredAt ?? new Date("2026-08-27T00:00:00Z"),
    source: { host: "ops-primary" },
    uptimeSeconds: 10,
    cpu: { usagePercent: overrides.cpu ?? 20, cores: [] },
    memory: { totalBytes: 100, usedBytes: overrides.memory ?? 20 },
    disk: {
      readsPerSecond: 0,
      writesPerSecond: 0,
      totalBytes: 100,
      usedBytes: overrides.disk ?? 20,
    },
    network: { rxBytesPerSecond: 0, txBytesPerSecond: 0, activeConnections: 0 },
    pm2: [],
  };
}

describe("host health", () => {
  const now = new Date("2026-08-27T00:00:30Z");

  it.each([
    [{ cpu: 90 }, "Critical"],
    [{ memory: 90 }, "Critical"],
    [{ disk: 95 }, "Critical"],
    [{ cpu: 75 }, "Degraded"],
    [{ memory: 80 }, "Degraded"],
    [{ disk: 85 }, "Degraded"],
    [{ cpu: 74.9, memory: 79.9, disk: 84.9 }, "Optimal"],
  ])("applies resource thresholds to %j", (values, status) => {
    expect(evaluateHostHealth(snapshot(values), now).status).toBe(status);
  });

  it("gives missing and stale data precedence over thresholds", () => {
    expect(evaluateHostHealth(null, now).status).toBe("Unknown");
    expect(
      evaluateHostHealth(
        snapshot({ cpu: 99, measuredAt: new Date("2026-08-26T23:58:00Z") }),
        now,
      ).status,
    ).toBe("Unknown");
  });
});
