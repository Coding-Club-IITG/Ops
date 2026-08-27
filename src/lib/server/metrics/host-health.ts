import type { MetricSnapshot } from "@/lib/server/metrics/metrics-types";

export type HostHealthStatus = "Unknown" | "Critical" | "Degraded" | "Optimal";
export type HostHealth = {
  status: HostHealthStatus;
  reasons: string[];
  evaluatedAt: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
};

function percent(used?: number, total?: number): number | null {
  return total && used !== undefined ? (used / total) * 100 : null;
}

export function evaluateHostHealth(
  snapshot: MetricSnapshot | null,
  now = new Date(),
): HostHealth {
  const evaluatedAt = now.toISOString();
  const cpuPercent = snapshot?.cpu.usagePercent ?? null;
  const memoryPercent = snapshot
    ? (snapshot.memory.pressurePercent ??
      percent(snapshot.memory.usedBytes, snapshot.memory.totalBytes))
    : null;
  const diskPercent = snapshot
    ? percent(snapshot.disk.usedBytes, snapshot.disk.totalBytes)
    : null;

  if (
    !snapshot ||
    now.getTime() - new Date(snapshot.measuredAt).getTime() > 60_000
  ) {
    return {
      status: "Unknown",
      reasons: [
        snapshot
          ? "Metrics are more than 60 seconds old"
          : "Metrics are unavailable",
      ],
      evaluatedAt,
      cpuPercent,
      memoryPercent,
      diskPercent,
    };
  }

  const critical: string[] = [];
  if (cpuPercent !== null && cpuPercent >= 90)
    critical.push("CPU is at least 90%");
  if (memoryPercent !== null && memoryPercent >= 90)
    critical.push("Memory is at least 90%");
  if (diskPercent !== null && diskPercent >= 95)
    critical.push("Disk is at least 95%");
  if (critical.length)
    return {
      status: "Critical",
      reasons: critical,
      evaluatedAt,
      cpuPercent,
      memoryPercent,
      diskPercent,
    };

  const degraded: string[] = [];
  if (cpuPercent !== null && cpuPercent >= 75)
    degraded.push("CPU is at least 75%");
  if (memoryPercent !== null && memoryPercent >= 80)
    degraded.push("Memory is at least 80%");
  if (diskPercent !== null && diskPercent >= 85)
    degraded.push("Disk is at least 85%");
  return {
    status: degraded.length ? "Degraded" : "Optimal",
    reasons: degraded,
    evaluatedAt,
    cpuPercent,
    memoryPercent,
    diskPercent,
  };
}
