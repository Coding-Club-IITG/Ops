import { describe, expect, it } from "vitest";
import { parseAuditQuery } from "@/lib/server/audit";

describe("audit query validation", () => {
  it("parses strict supported filters", () => {
    expect(
      parseAuditQuery(
        "http://ops.test/api/audit?from=2026-08-01T00%3A00%3A00Z&to=2026-08-27T00%3A00%3A00Z&action=logs.export&actor=operator-1&limit=25&offset=50",
      ),
    ).toMatchObject({
      action: "logs.export",
      actor: "operator-1",
      limit: 25,
      offset: 50,
    });
  });

  it("rejects unknown actions, fields, reversed dates, and unbounded pages", () => {
    expect(() =>
      parseAuditQuery("http://ops.test/api/audit?action=logs.delete"),
    ).toThrow();
    expect(() =>
      parseAuditQuery("http://ops.test/api/audit?unknown=true"),
    ).toThrow();
    expect(() =>
      parseAuditQuery(
        "http://ops.test/api/audit?from=2026-08-27T00%3A00%3A00Z&to=2026-08-01T00%3A00%3A00Z",
      ),
    ).toThrow();
    expect(() =>
      parseAuditQuery("http://ops.test/api/audit?limit=101"),
    ).toThrow();
  });
});
