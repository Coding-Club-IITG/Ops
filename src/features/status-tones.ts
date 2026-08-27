import type { StatusTone } from "@/components/StatusBadge";

export const HOST_HEALTH_TONES = {
  Unknown: "neutral",
  Critical: "danger",
  Degraded: "warning",
  Optimal: "success",
} as const satisfies Record<string, StatusTone>;

export const SERVICE_STATUS_TONES = {
  healthy: "success",
  stale: "warning",
  unknown: "neutral",
} as const satisfies Record<string, StatusTone>;

export function processStatusTone(status: string): StatusTone {
  if (status === "online") return "success";
  if (status === "errored") return "danger";
  if (status === "stopped" || status === "stopping") return "warning";
  return "neutral";
}

export function telemetryStatusTone(
  status: "available" | "partial" | "unavailable",
): StatusTone {
  if (status === "available") return "success";
  if (status === "partial") return "warning";
  return "neutral";
}
