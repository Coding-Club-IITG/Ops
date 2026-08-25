export type Pm2Metric = {
  name: string;
  status: string;
  uptimeSeconds: number;
  restartCount: number;
  cpuPercent: number;
  memoryMb: number;
};

export type MetricSnapshot = {
  measuredAt: Date;
  source: { host: string };
  uptimeSeconds: number;
  cpu: { usagePercent: number; cores: number[] };
  memory: { totalBytes: number; usedBytes: number };
  disk: { readsPerSecond: number; writesPerSecond: number };
  network: {
    rxBytesPerSecond: number;
    txBytesPerSecond: number;
    activeConnections: number;
  };
  pm2: Pm2Metric[];
};
