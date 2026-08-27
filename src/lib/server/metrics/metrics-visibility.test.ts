import { describe, expect, it } from "vitest";
import { metricSnapshotForRole } from "@/lib/server/metrics/metrics-visibility";
import type { MetricSnapshot } from "@/lib/server/metrics/metrics-types";

const snapshot: MetricSnapshot = {
  measuredAt: new Date("2026-08-27T00:00:00Z"),
  source: { host: "ops-primary" },
  uptimeSeconds: 1,
  cpu: { usagePercent: 10, cores: [10] },
  memory: { totalBytes: 100, usedBytes: 50 },
  disk: {
    readsPerSecond: 1,
    writesPerSecond: 2,
    readWaitMilliseconds: 3,
    writeWaitMilliseconds: 4,
    partitions: [
      {
        mount: "/",
        totalBytes: 100,
        usedBytes: 50,
        freeBytes: 50,
        usePercent: 50,
      },
    ],
  },
  network: {
    rxBytesPerSecond: 1,
    txBytesPerSecond: 2,
    activeConnections: 3,
    interfaces: [
      {
        name: "eth0",
        state: "up",
        rxBytesPerSecond: 1,
        txBytesPerSecond: 2,
        droppedPackets: 0,
        errors: 0,
      },
    ],
  },
  pm2: [
    {
      name: "ops-web",
      status: "online",
      uptimeSeconds: 1,
      restartCount: 0,
      cpuPercent: 1,
      memoryMb: 64,
    },
  ],
  topProcesses: {
    cpu: [{ name: "node", pid: 1, cpuPercent: 2, memoryBytes: 3 }],
    memory: [],
  },
};

describe("metric response visibility", () => {
  it("strips OS processes, interfaces, and partitions for viewers", () => {
    const viewer = metricSnapshotForRole(snapshot, "viewer");
    expect(viewer).not.toHaveProperty("topProcesses");
    expect(viewer.disk).not.toHaveProperty("partitions");
    expect(viewer.disk).toMatchObject({
      readWaitMilliseconds: 3,
      writeWaitMilliseconds: 4,
    });
    expect(viewer.network).not.toHaveProperty("interfaces");
    expect(viewer.pm2[0]).toMatchObject({ memoryBytes: 64 * 1_024 * 1_024 });
    expect(viewer.pm2[0]).not.toHaveProperty("memoryMb");
  });

  it("keeps legacy combined disk-wait snapshots readable", () => {
    const legacy = {
      ...snapshot,
      disk: {
        ...snapshot.disk,
        readWaitMilliseconds: undefined,
        writeWaitMilliseconds: undefined,
        waitMilliseconds: 7,
      },
    };
    expect(metricSnapshotForRole(legacy, "viewer").disk.waitMilliseconds).toBe(
      7,
    );
  });

  it("retains restricted fields for admins", () => {
    const admin = metricSnapshotForRole(snapshot, "admin");
    expect(admin.topProcesses?.cpu[0]).toMatchObject({ name: "node", pid: 1 });
    expect(admin.disk.partitions).toHaveLength(1);
    expect(admin.network.interfaces).toHaveLength(1);
  });
});
