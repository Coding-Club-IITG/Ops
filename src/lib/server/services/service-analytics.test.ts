import { describe, expect, it } from "vitest";
import {
  fillServiceBuckets,
  getRegisteredService,
  percentile,
  pm2TelemetryState,
} from "@/lib/server/services/service-analytics";

describe("service analytics helpers", () => {
  it("accepts only exact registered service names", () => {
    expect(getRegisteredService("hab-api-v2")).toEqual({
      service: "hab-api-v2",
      project: "habit",
    });
    expect(getRegisteredService("HAB-API-V2")).toBeNull();
    expect(getRegisteredService("hab-api-v2 ")).toBeNull();
  });

  it("calculates interpolated percentiles without mutating input", () => {
    const values = [40, 10, 30, 20];
    expect(percentile(values, 0.5)).toBe(25);
    expect(percentile(values, 0.95)).toBeCloseTo(38.5);
    expect(percentile([], 0.99)).toBeNull();
    expect(values).toEqual([40, 10, 30, 20]);
  });

  it("fills adaptive UTC buckets with explicit empty values", () => {
    const buckets = fillServiceBuckets(
      [
        {
          timestamp: "2026-08-27T00:00:20Z",
          httpCount: 2,
          requestRatePerSecond: 2 / 60,
          http5xxCount: 1,
          http5xxRate: 0.5,
          applicationErrorCount: 0,
          latencyP50Ms: 10,
          latencyP95Ms: 20,
          latencyP99Ms: 25,
        },
      ],
      new Date("2026-08-27T00:00:00Z"),
      new Date("2026-08-27T00:01:30Z"),
      60,
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[1]).toMatchObject({ httpCount: 0, latencyP95Ms: null });
  });

  it("distinguishes empty, partial, and complete PM2 telemetry", () => {
    expect(pm2TelemetryState(10, 0)).toBe("unavailable");
    expect(pm2TelemetryState(10, 4)).toBe("partial");
    expect(pm2TelemetryState(10, 10)).toBe("available");
  });
});
