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
              memoryMb: Math.round((process.monit?.memory ?? 0) / 1024 / 1024),
            })),
        );
      });
    });
  });
}

export async function collectMetricSnapshot(): Promise<MetricSnapshot> {
  const [load, memory, disk, network, connections, time, pm2Metrics] =
    await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.disksIO(),
      si.networkStats(),
      si.networkConnections(),
      si.time(),
      collectPm2(),
    ]);

  return {
    measuredAt: new Date(),
    source: { host: "ops-primary" },
    uptimeSeconds: time.uptime,
    cpu: {
      usagePercent: load.currentLoad,
      cores: load.cpus.map((core) => core.load),
    },
    memory: { totalBytes: memory.total, usedBytes: memory.active },
    disk: {
      readsPerSecond: disk?.rIO_sec ?? 0,
      writesPerSecond: disk?.wIO_sec ?? 0,
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
    },
    pm2: pm2Metrics,
  };
}
