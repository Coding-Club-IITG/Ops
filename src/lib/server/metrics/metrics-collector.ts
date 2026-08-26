import pm2 from "pm2";
import si from "systeminformation";
import type {
  MetricSnapshot,
  Pm2Metric,
} from "@/lib/server/metrics/metrics-types";
import { LOG_EVENT_SERVICES } from "@contracts/log-event-v1/project-registry";

const REGISTERED_PROCESSES = new Set([
  "ops-web",
  "ops-worker",
  ...LOG_EVENT_SERVICES,
]);

async function collectPm2(): Promise<Pm2Metric[]> {
  return new Promise((resolve) => {
    pm2.connect((connectError) => {
      if (connectError) return resolve([]);
      pm2.list((listError, processes) => {
        pm2.disconnect();
        if (listError) return resolve([]);
        resolve(
          processes
            .filter(
              (process) =>
                process.name && REGISTERED_PROCESSES.has(process.name),
            )
            .map((process) => ({
              name: process.name ?? "unknown",
              status: process.pm2_env?.status ?? "unknown",
              uptimeSeconds: process.pm2_env?.pm_uptime
                ? Math.max(
                    0,
                    Math.floor(
                      (Date.now() - process.pm2_env.pm_uptime) / 1_000,
                    ),
                  )
                : 0,
              restartCount: process.pm2_env?.restart_time ?? 0,
              cpuPercent: process.monit?.cpu ?? 0,
              memoryBytes: process.monit?.memory ?? 0,
            })),
        );
      });
    });
  });
}

async function safely<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}

export async function collectMetricSnapshot(): Promise<MetricSnapshot> {
  const [
    load,
    memory,
    disk,
    filesystems,
    network,
    connections,
    processes,
    time,
    pm2Metrics,
  ] = await Promise.all([
    safely(() => si.currentLoad(), null),
    safely(() => si.mem(), null),
    safely(() => si.disksIO(), null),
    safely(() => si.fsSize(), []),
    safely(() => si.networkStats(), []),
    safely(() => si.networkConnections(), []),
    safely(() => si.processes(), null),
    safely(async () => si.time(), { uptime: 0 } as ReturnType<
      typeof si.time
    > extends Promise<infer T>
      ? T
      : never),
    collectPm2(),
  ]);

  const cores = load?.cpus?.map((core) => core.load) ?? [];
  const usedBytes = memory?.active ?? memory?.used ?? 0;
  const totalBytes = memory?.total ?? 0;
  const partitions = filesystems.map((filesystem) => ({
    mount: filesystem.mount,
    totalBytes: filesystem.size,
    usedBytes: filesystem.used,
    freeBytes: filesystem.available,
    usePercent: filesystem.use,
  }));
  const processMetrics = (processes?.list ?? []).map((process) => ({
    name: process.name,
    pid: process.pid,
    cpuPercent: process.cpu,
    memoryBytes: Math.max(0, process.memRss * 1_024),
  }));
  const interfaceMetrics = network.map((item) => ({
    name: item.iface,
    state: item.operstate,
    rxBytesPerSecond: item.rx_sec ?? 0,
    txBytesPerSecond: item.tx_sec ?? 0,
    droppedPackets: (item.rx_dropped ?? 0) + (item.tx_dropped ?? 0),
    errors: (item.rx_errors ?? 0) + (item.tx_errors ?? 0),
  }));

  return {
    measuredAt: new Date(),
    source: { host: "ops-primary" },
    uptimeSeconds: time.uptime ?? 0,
    cpu: {
      usagePercent: load?.currentLoad ?? 0,
      cores,
      averagePercent: cores.length
        ? cores.reduce((sum, value) => sum + value, 0) / cores.length
        : (load?.currentLoad ?? 0),
      minimumCorePercent: cores.length
        ? Math.min(...cores)
        : (load?.currentLoad ?? 0),
      maximumCorePercent: cores.length
        ? Math.max(...cores)
        : (load?.currentLoad ?? 0),
    },
    memory: {
      totalBytes,
      usedBytes,
      freeBytes: memory?.free ?? 0,
      availableBytes: memory?.available ?? memory?.free ?? 0,
      pressurePercent: totalBytes ? (usedBytes / totalBytes) * 100 : 0,
    },
    disk: {
      readsPerSecond: disk?.rIO_sec ?? 0,
      writesPerSecond: disk?.wIO_sec ?? 0,
      waitMilliseconds: disk?.tWaitTime ?? 0,
      totalBytes: partitions.reduce(
        (sum, partition) => sum + partition.totalBytes,
        0,
      ),
      usedBytes: partitions.reduce(
        (sum, partition) => sum + partition.usedBytes,
        0,
      ),
      freeBytes: partitions.reduce(
        (sum, partition) => sum + partition.freeBytes,
        0,
      ),
      partitions,
    },
    network: {
      rxBytesPerSecond: network.reduce(
        (sum, item) => sum + (item.rx_sec ?? 0),
        0,
      ),
      txBytesPerSecond: network.reduce(
        (sum, item) => sum + (item.tx_sec ?? 0),
        0,
      ),
      activeConnections: connections.length,
      droppedPackets: interfaceMetrics.reduce(
        (sum, item) => sum + item.droppedPackets,
        0,
      ),
      errors: interfaceMetrics.reduce((sum, item) => sum + item.errors, 0),
      interfaces: interfaceMetrics,
    },
    pm2: pm2Metrics,
    topProcesses: {
      cpu: [...processMetrics]
        .sort((left, right) => right.cpuPercent - left.cpuPercent)
        .slice(0, 10),
      memory: [...processMetrics]
        .sort((left, right) => right.memoryBytes - left.memoryBytes)
        .slice(0, 10),
    },
  };
}
