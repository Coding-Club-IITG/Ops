import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMetricSeriesBuckets,
  buildMetricGrouping,
  buildProjectMetricWhere,
  deleteExpiredMetricEvents,
  getMetricCatalog,
  insertMetricEvent,
  limitMetricGroups,
  projectMetricQuerySchema,
  selectMetricBucketDuration,
} from "@/lib/server/metrics/project-metrics";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/lib/server/postgres", () => ({
  getPostgresPool: () => ({ query: queryMock }),
}));

const query = projectMetricQuerySchema.parse({
  project: "coursehub",
  metric: "course.view",
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-28T00:00:00.000Z",
  filters: { courseCode: "CS101", studentYear: 2 },
  groupBy: ["studentYear", "cached"],
});

describe("dynamic project metric queries", () => {
  beforeEach(() => queryMock.mockReset());

  it("parameterizes arbitrary exact-match dimension filters", () => {
    const parts = buildProjectMetricWhere(query);
    expect(parts.conditions.join(" ")).not.toContain("CS101");
    expect(parts.conditions.join(" ")).toContain("dimensions @>");
    expect(parts.values).toContain(JSON.stringify(query.filters));
  });

  it("parameterizes arbitrary multi-dimension grouping combinations", () => {
    const values: unknown[] = ["existing"];
    const sql = buildMetricGrouping(
      ["studentYear", "courseCode", "cached"],
      values,
    );
    expect(sql).not.toContain("studentYear");
    expect(sql).toContain("$2::text");
    expect(values).toEqual(["existing", "studentYear", "courseCode", "cached"]);
  });

  it("stores event IDs idempotently", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    const inserted = await insertMetricEvent({
      schemaVersion: 1,
      eventId: "metric-1",
      timestamp: "2026-08-28T00:00:00.000Z",
      project: "coursehub",
      service: "coursehub-backend",
      name: "unknown.metric",
      value: 2,
      dimensions: { arbitrary: true },
    });
    expect(inserted).toBe(true);
    expect(queryMock.mock.calls[0][0]).toContain(
      "ON CONFLICT (event_id) DO NOTHING",
    );
    expect(queryMock.mock.calls[0][1][0]).toBe("metric-1");
  });

  it("discovers unknown metrics, dimension keys, and observed values from storage", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ project: "coursehub", services: ["coursehub-backend"] }],
      })
      .mockResolvedValueOnce({ rows: [{ name: "previously.unknown.metric" }] })
      .mockResolvedValueOnce({
        rows: [{ key: "arbitraryKey", values: ["new-value", "second-value"] }],
      });
    const catalog = await getMetricCatalog({
      project: "coursehub",
      metric: "previously.unknown.metric",
    });
    expect(catalog.metrics).toEqual(["previously.unknown.metric"]);
    expect(catalog.dimensions).toEqual([
      { key: "arbitraryKey", values: ["new-value", "second-value"] },
    ]);
    expect(queryMock.mock.calls[2][0]).toContain("rank <= 100");
  });

  it("applies the fixed 90-day raw event retention window", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 7 });
    await expect(deleteExpiredMetricEvents()).resolves.toBe(7);
    expect(queryMock.mock.calls[0][1]).toEqual([90]);
  });

  it("supports automatic buckets through 90 days", () => {
    expect(selectMetricBucketDuration(60 * 60 * 1_000)).toBe(60);
    expect(selectMetricBucketDuration(24 * 60 * 60 * 1_000)).toBe(900);
    expect(selectMetricBucketDuration(90 * 24 * 60 * 60 * 1_000)).toBe(86_400);
  });

  it("fills empty buckets while preserving sums and event counts", () => {
    const dimensions = { studentYear: 2 };
    const groups = [{ dimensions, summedValue: 5, eventCount: 2 }];
    const buckets = buildMetricSeriesBuckets(
      [
        {
          timestamp: "2026-08-28T00:01:00.000Z",
          dimensions,
          summedValue: 5,
          eventCount: 2,
        },
      ],
      groups,
      "2026-08-28T00:00:00.000Z",
      "2026-08-28T00:02:00.000Z",
      60,
    );
    expect(buckets).toHaveLength(3);
    expect(
      buckets.map(({ summedValue, eventCount }) => [summedValue, eventCount]),
    ).toEqual([
      [0, 0],
      [5, 2],
      [0, 0],
    ]);
  });

  it("returns only the top 100 dimension combinations and flags truncation", () => {
    const result = limitMetricGroups(
      Array.from({ length: 101 }, (_, index) => ({
        dimensions: { cohort: index },
        summedValue: 101 - index,
        eventCount: 1,
      })),
    );
    expect(result.groups).toHaveLength(100);
    expect(result.groups[0].dimensions).toEqual({ cohort: 0 });
    expect(result.truncated).toBe(true);
  });

  it("rejects ranges beyond retention and duplicate grouping keys", () => {
    expect(() =>
      projectMetricQuerySchema.parse({
        ...query,
        from: "2026-05-01T00:00:00.000Z",
        groupBy: ["studentYear", "studentYear"],
      }),
    ).toThrow();
  });
});
