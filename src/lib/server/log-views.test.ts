import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOG_VIEWS,
  LOG_VIEW_COLUMNS,
  logViewInputSchema,
} from "@/lib/server/log-views";

describe("team log view validation", () => {
  it("accepts relative presets, strict filters, sort, and allow-listed columns", () => {
    expect(logViewInputSchema.parse(DEFAULT_LOG_VIEWS[1].view)).toMatchObject({
      relativeTime: "24h",
      filters: { kind: "http", statusClass: "5xx" },
    });
  });

  it("rejects absolute timestamps and unknown columns", () => {
    const view = DEFAULT_LOG_VIEWS[0].view;
    expect(() =>
      logViewInputSchema.parse({ ...view, from: "2026-08-27T00:00:00Z" }),
    ).toThrow();
    expect(() =>
      logViewInputSchema.parse({ ...view, visibleColumns: ["requestBody"] }),
    ).toThrow();
  });

  it("uses stable unique default identifiers and names", () => {
    expect(new Set(DEFAULT_LOG_VIEWS.map((view) => view.id)).size).toBe(
      DEFAULT_LOG_VIEWS.length,
    );
    expect(new Set(DEFAULT_LOG_VIEWS.map((view) => view.view.name)).size).toBe(
      DEFAULT_LOG_VIEWS.length,
    );
    expect(LOG_VIEW_COLUMNS).toContain("attribute:operation");
  });
});
