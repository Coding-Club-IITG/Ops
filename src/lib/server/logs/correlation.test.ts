import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/server/postgres", () => ({
  getPostgresPool: () => ({ query }),
}));

import { listCorrelationTimeline } from "@/lib/server/logs/log-repository";

describe("correlation timeline query", () => {
  beforeEach(() => query.mockReset());

  it("uses a parameterized retained-window query, chronological ordering, and a 500 cap", async () => {
    query.mockResolvedValue({
      rows: [
        {
          eventId: "evt-1",
          timestamp: "2026-08-27T00:00:00Z",
          totalCount: "501",
        },
      ],
    });
    const result = await listCorrelationTimeline("corr'; DELETE --");
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("correlation_id = $1");
    expect(sql).toContain("INTERVAL '30 days'");
    expect(sql).toContain("ORDER BY occurred_at ASC, event_id ASC");
    expect(sql).not.toContain("corr'; DELETE --");
    expect(values).toEqual(["corr'; DELETE --", 500]);
    expect(result).toMatchObject({ total: 501, truncated: true });
    expect(result.data[0]).not.toHaveProperty("totalCount");
    expect(result.data[0]).not.toHaveProperty("diagnostic");
    expect(result.data[0]).not.toHaveProperty("ingestedAt");
  });
});
