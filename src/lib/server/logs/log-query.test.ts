import { describe, expect, it } from "vitest";
import { parseLogsQuery } from "@/lib/server/logs/log-query";

describe("log query validation", () => {
  it("accepts only allowlisted sort fields", () => {
    expect(() =>
      parseLogsQuery("http://ops.test/api/logs?sort=timestamp&limit=50"),
    ).not.toThrow();
    expect(() =>
      parseLogsQuery(
        "http://ops.test/api/logs?sort=timestamp%3BDELETE%20FROM%20ops.log_events",
      ),
    ).toThrow();
  });

  it("enforces bounded pages", () => {
    expect(() =>
      parseLogsQuery("http://ops.test/api/logs?limit=101"),
    ).toThrow();
  });
});
