import type { MetricSnapshot } from "@/lib/server/metrics/metrics-types";

type ViewerMetricSnapshot = Omit<
  MetricSnapshot,
  "topProcesses" | "disk" | "network"
> & {
  disk: Omit<MetricSnapshot["disk"], "partitions">;
  network: Omit<MetricSnapshot["network"], "interfaces">;
};

export function metricSnapshotForRole(
  snapshot: MetricSnapshot,
  role: "admin",
): MetricSnapshot;
export function metricSnapshotForRole(
  snapshot: MetricSnapshot,
  role: "viewer",
): ViewerMetricSnapshot;
export function metricSnapshotForRole(
  snapshot: MetricSnapshot,
  role: "viewer" | "admin",
): MetricSnapshot | ViewerMetricSnapshot;
export function metricSnapshotForRole(
  snapshot: MetricSnapshot,
  role: "viewer" | "admin",
): MetricSnapshot | ViewerMetricSnapshot {
  const pm2 = snapshot.pm2.map(({ memoryMb, ...process }) => ({
    ...process,
    memoryBytes: process.memoryBytes ?? (memoryMb ?? 0) * 1_024 * 1_024,
  }));
  if (role === "admin") return { ...snapshot, pm2 };
  const { partitions: _partitions, ...disk } = snapshot.disk;
  const { interfaces: _interfaces, ...network } = snapshot.network;
  const { topProcesses: _topProcesses, ...publicSnapshot } = snapshot;
  return { ...publicSnapshot, disk, network, pm2 };
}
