export type Pm2Metric = {
  name: string;
  status: string;
  uptimeSeconds: number;
  restartCount: number;
  cpuPercent: number;
  memoryBytes?: number;
  /** Legacy snapshots only. New API responses normalize this to memoryBytes. */
  memoryMb?: number;
};

export type OsProcessMetric = {
  name: string;
  pid: number;
  cpuPercent: number;
  memoryBytes: number;
};

export type MetricSnapshot = {
  measuredAt: Date;
  source: { host: string };
  uptimeSeconds: number;
  cpu: {
    usagePercent: number;
    cores: number[];
    averagePercent?: number;
    minimumCorePercent?: number;
    maximumCorePercent?: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes?: number;
    availableBytes?: number;
    pressurePercent?: number;
  };
  disk: {
    readsPerSecond: number;
    writesPerSecond: number;
    readWaitMilliseconds?: number;
    writeWaitMilliseconds?: number;
    waitMilliseconds?: number;
    totalBytes?: number;
    usedBytes?: number;
    freeBytes?: number;
    partitions?: Array<{
      mount: string;
      totalBytes: number;
      usedBytes: number;
      freeBytes: number;
      usePercent: number;
    }>;
  };
  network: {
    rxBytesPerSecond: number;
    txBytesPerSecond: number;
    activeConnections: number;
    droppedPackets?: number;
    errors?: number;
    interfaces?: Array<{
      name: string;
      state: string;
      rxBytesPerSecond: number;
      txBytesPerSecond: number;
      droppedPackets: number;
      errors: number;
    }>;
  };
  pm2: Pm2Metric[];
  topProcesses?: {
    cpu: OsProcessMetric[];
    memory: OsProcessMetric[];
  };
};
