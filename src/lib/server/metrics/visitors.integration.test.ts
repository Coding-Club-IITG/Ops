import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensurePostgresSchema } from "@/lib/server/postgres-schema";
import {
  getMetricCatalog,
  insertMetricEvent,
  projectMetricQuerySchema,
  queryProjectMetrics,
} from "@/lib/server/metrics/project-metrics";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/server/postgres", () => ({
  getPostgresPool: () => state.pool!,
}));
const url = process.env.OPS_TEST_DATABASE_URL;

describe.skipIf(!url)("visitor counts in PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      !parsed.pathname.startsWith("/ops-test-")
    ) {
      throw new Error(
        "Visitor tests require an isolated local ops-test-* database",
      );
    }
    state.pool = new Pool({ connectionString: url });
    await ensurePostgresSchema();
    // The migration must be safe to run again on an existing installation.
    await ensurePostgresSchema();
    await state.pool.query("TRUNCATE ops.metric_events");
    const timestamp = new Date();
    timestamp.setUTCSeconds(0, 0);
    timestamp.setUTCMinutes(0);
    const yesterday = new Date(timestamp.getTime() - 86400_000).toISOString();
    const today = timestamp.toISOString();
    for (const [eventId, visitorKey, page, time, project, service] of [
      ["visitor-test-1", "a", "/", yesterday, "ccw", "ccw-web"],
      ["visitor-test-2", "a", "/blog", yesterday, "ccw", "ccw-web"],
      ["visitor-test-3", "a", "/", today, "ccw", "ccw-web"],
      ["visitor-test-4", "b", "/blog", today, "ccw", "ccw-web"],
      ["visitor-test-5", "c", "/", today, "coursehub", "coursehub-backend"],
    ]) {
      await insertMetricEvent({
        schemaVersion: 1,
        eventId,
        timestamp: time,
        project: project as "ccw",
        service: service as "ccw-web",
        name: "web.page_view",
        value: 1,
        dimensions: { visitorKey: visitorKey.repeat(64), page },
      });
    }
  });
  afterAll(async () => {
    await state.pool?.end();
  });

  function query(filters = {}, groupBy: string[] = []) {
    return queryProjectMetrics(
      projectMetricQuerySchema.parse({
        project: "ccw",
        metric: "web.page_view",
        from: new Date(Date.now() - 3 * 86400_000).toISOString(),
        to: new Date().toISOString(),
        filters,
        groupBy,
      }),
    );
  }

  it("deduplicates across pages and days and isolates projects", async () => {
    const result = await query();
    expect(result.totals).toEqual({
      summedValue: 4,
      eventCount: 4,
      uniqueVisitors: 2,
    });
    expect(
      result.series.reduce((sum, row) => sum + row.uniqueVisitors, 0),
    ).toBe(3);
    expect(result.series.reduce((sum, row) => sum + row.eventCount, 0)).toBe(4);
  });
  it("counts distinct visitors separately for each page and filtered range", async () => {
    const result = await query({}, ["page"]);
    expect(result.totals.uniqueVisitors).toBe(2);
    expect(result.groups).toEqual(
      expect.arrayContaining([
        {
          dimensions: { page: "/" },
          summedValue: 2,
          eventCount: 2,
          uniqueVisitors: 1,
        },
        {
          dimensions: { page: "/blog" },
          summedValue: 2,
          eventCount: 2,
          uniqueVisitors: 2,
        },
      ]),
    );
    expect((await query({ page: "/" })).totals.uniqueVisitors).toBe(1);
    expect((await query({ page: "/missing" })).totals.uniqueVisitors).toBe(0);
  });
  it("never exposes visitor keys through dimensions or query results", async () => {
    const catalog = await getMetricCatalog({
      project: "ccw",
      metric: "web.page_view",
    });
    expect(catalog.dimensions.map((dimension) => dimension.key)).toEqual([
      "page",
    ]);
    expect(JSON.stringify(await query())).not.toContain("a".repeat(64));
    const { rows } = await state.pool!.query(
      "SELECT visitor_key, dimensions FROM ops.metric_events WHERE event_id = 'visitor-test-1'",
    );
    expect(rows[0]).toEqual({
      visitor_key: "a".repeat(64),
      dimensions: { page: "/" },
    });
  });
  it("preserves legacy metric sums and event counts", async () => {
    await insertMetricEvent({
      schemaVersion: 1,
      eventId: "legacy-metric",
      timestamp: new Date().toISOString(),
      project: "ccw",
      service: "ccw-web",
      name: "legacy.metric",
      value: 8,
      dimensions: { category: "test" },
    });
    const result = await queryProjectMetrics(
      projectMetricQuerySchema.parse({
        project: "ccw",
        metric: "legacy.metric",
        from: new Date(Date.now() - 86400_000).toISOString(),
        to: new Date().toISOString(),
      }),
    );
    expect(result.totals).toEqual({
      summedValue: 8,
      eventCount: 1,
      uniqueVisitors: 0,
    });
  });
});
