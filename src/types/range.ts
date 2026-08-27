export const OPS_RANGES = ["1h", "6h", "24h", "7d", "30d"] as const;
export type OpsRange = (typeof OPS_RANGES)[number];
