import { describe, expect, it } from "vitest";
import { clampExportWindow, logsToCsv } from "@/lib/server/logs/csv";

describe("safe CSV export", () => {
  it("contains only canonical safe columns", () => {
    const csv = logsToCsv([]);
    expect(csv).not.toMatch(/body|header|cookie|userAgent|ipAddress/i);
    expect(csv).toContain("eventId,timestamp,project,service");
  });

  it("caps requested windows at 24 hours", () => {
    const window = clampExportWindow(
      "2026-08-01T00:00:00.000Z",
      "2026-08-26T00:00:00.000Z",
    );
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
