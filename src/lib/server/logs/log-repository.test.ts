import { describe, expect, it } from "vitest";
import {
  buildLogVolumeBuckets,
  buildLogWhere,
  selectLogBucketDuration,
  serializeDiagnosticJson,
} from "@/lib/server/logs/log-repository";

describe("diagnostic PostgreSQL serialization", () => {
  it("encodes frames and causes as JSON rather than PostgreSQL arrays", () => {
    const serialized = serializeDiagnosticJson({
      message: "Synthetic failure",
      frames: [{ function: "run", file: "src/worker.ts", line: 10, column: 2 }],
      cause: {
        name: "DependencyError",
        message: "Dependency failed",
        frames: [{ file: "src/dependency.ts", line: 4, column: 1 }],
      },
      fingerprint: "a".repeat(64),
      redactionCount: 1,
    });

    expect(JSON.parse(serialized.frames)).toEqual([
      { function: "run", file: "src/worker.ts", line: 10, column: 2 },
    ]);
    expect(JSON.parse(serialized.cause ?? "null")).toMatchObject({
      name: "DependencyError",
      message: "Dependency failed",
    });
  });

  it("stores a missing cause as SQL null", () => {
    const serialized = serializeDiagnosticJson({
      message: "Synthetic failure",
      frames: [],
      fingerprint: "b".repeat(64),
      redactionCount: 0,
    });
    expect(serialized.frames).toBe("[]");
    expect(serialized.cause).toBeNull();
  });
});

describe("parameterized log queries", () => {
  it("keeps all filter values out of SQL fragments", () => {
    const query = {
      eventId: "event'; DELETE FROM ops.log_events; --",
      method: "GET",
      statusClass: "5xx" as const,
      q: "failure | pg_sleep(10)",
      limit: 50,
      offset: 0,
      sort: "timestamp" as const,
      order: "desc" as const,
    };
    const where = buildLogWhere(query);
    expect(where.conditions.join(" ")).not.toContain(query.eventId);
    expect(where.conditions.join(" ")).not.toContain(query.q);
    expect(where.values).toContain(query.eventId);
    expect(where.values).toContain(query.q);
    expect(where.values).toContain(500);
    expect(where.values).toContain(599);
  });
});

describe("adaptive log volume buckets", () => {
  it.each([
    [60 * 60 * 1_000, 60],
    [6 * 60 * 60 * 1_000, 600],
    [24 * 60 * 60 * 1_000, 3_600],
    [7 * 24 * 60 * 60 * 1_000, 21_600],
    [30 * 24 * 60 * 60 * 1_000, 86_400],
  ])("uses the expected boundary for %i ms", (range, expected) => {
    expect(selectLogBucketDuration(range)).toBe(expected);
  });

  it("fills empty UTC buckets and consistently exposes every level", () => {
    const buckets = buildLogVolumeBuckets(
      [
        { timestamp: "2026-08-27T00:00:15Z", level: "info", count: "2" },
        { timestamp: "2026-08-27T00:02:10Z", level: "fatal", count: "1" },
      ],
      new Date("2026-08-27T00:00:00Z"),
      new Date("2026-08-27T00:02:59Z"),
      60,
    );
    expect(buckets).toHaveLength(3);
    expect(buckets[1]).toEqual({
      timestamp: "2026-08-27T00:01:00.000Z",
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
      total: 0,
    });
    expect(buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(3);
  });
});
