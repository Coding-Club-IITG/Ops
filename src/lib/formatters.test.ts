import { describe, expect, it } from "vitest";
import { formatIst, formatIstInput, parseIstInput } from "@/lib/formatters";

describe("IST date formatting", () => {
  it("converts a UTC instant to IST for display", () => {
    expect(formatIst("2026-09-02T06:30:00.000Z")).toContain("12:00:00");
    expect(formatIstInput("2026-09-02T06:30:00.000Z")).toBe(
      "2026-09-02T12:00",
    );
  });

  it("converts an IST filter value back to the same UTC instant", () => {
    expect(parseIstInput("2026-09-02T12:00")).toBe(
      "2026-09-02T06:30:00.000Z",
    );
  });
});
