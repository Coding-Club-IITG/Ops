import { describe, expect, it, vi } from "vitest";

vi.mock("pm2", () => ({
  default: {
    connect: (callback: (error: Error) => void) =>
      callback(new Error("PM2 unavailable")),
  },
}));

vi.mock("systeminformation", () => ({
  default: {
    currentLoad: vi.fn().mockResolvedValue({ currentLoad: 24, cpus: [] }),
    mem: vi.fn().mockRejectedValue(new Error("memory unavailable")),
    disksIO: vi.fn().mockResolvedValue(null),
    fsSize: vi.fn().mockResolvedValue([]),
    networkStats: vi.fn().mockResolvedValue([
      {
        iface: "eth0",
        operstate: "up",
        rx_sec: null,
        tx_sec: 20,
        rx_dropped: 1,
        tx_dropped: 2,
        rx_errors: 0,
        tx_errors: 1,
      },
    ]),
    networkConnections: vi
      .fn()
      .mockRejectedValue(new Error("connections unavailable")),
    processes: vi.fn().mockResolvedValue({
      list: [
        {
          name: "node",
          pid: 42,
          cpu: 5,
          memRss: 1024,
          command: "must-not-be-stored --token secret",
          params: "--token secret",
          path: "/private/path",
        },
      ],
    }),
    time: vi.fn().mockReturnValue({ uptime: 123 }),
  },
}));

import { collectMetricSnapshot } from "@/lib/server/metrics/metrics-collector";

describe("metric collection degradation", () => {
  it("keeps partial system information and omits prohibited process fields", async () => {
    const snapshot = await collectMetricSnapshot();
    expect(snapshot.cpu.usagePercent).toBe(24);
    expect(snapshot.memory).toMatchObject({ totalBytes: 0, usedBytes: 0 });
    expect(snapshot.network).toMatchObject({
      rxBytesPerSecond: 0,
      txBytesPerSecond: 20,
      activeConnections: 0,
      droppedPackets: 3,
      errors: 1,
    });
    expect(snapshot.pm2).toEqual([]);
    expect(snapshot.disk).toMatchObject({
      readWaitMilliseconds: 0,
      writeWaitMilliseconds: 0,
      waitMilliseconds: 0,
    });
    expect(snapshot.topProcesses?.cpu[0]).toEqual({
      name: "node",
      pid: 42,
      cpuPercent: 5,
      memoryBytes: 1_048_576,
    });
    expect(JSON.stringify(snapshot)).not.toContain("must-not-be-stored");
    expect(JSON.stringify(snapshot)).not.toContain("/private/path");
  });
});
