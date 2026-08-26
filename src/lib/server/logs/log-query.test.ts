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

  it("parses every supported filter and sorting parameter", () => {
    const query = parseLogsQuery(
      "http://ops.test/api/logs?from=2026-08-26T00%3A00%3A00Z&to=2026-08-27T00%3A00%3A00Z&eventId=evt-1&project=habit&service=hab-api-v2&kind=http&level=warn&correlationId=corr-1&method=POST&route=%2Fapi%2Fitems%2F%3Aid&statusCode=503&statusClass=5xx&durationMin=10&durationMax=2000&q=timeout&limit=25&offset=50&sort=durationMs&order=asc",
    );
    expect(query).toMatchObject({
      eventId: "evt-1",
      project: "habit",
      service: "hab-api-v2",
      kind: "http",
      level: "warn",
      correlationId: "corr-1",
      method: "POST",
      route: "/api/items/:id",
      statusCode: 503,
      statusClass: "5xx",
      durationMin: 10,
      durationMax: 2_000,
      q: "timeout",
      limit: 25,
      offset: 50,
      sort: "durationMs",
      order: "asc",
    });
  });

  it("rejects reversed dates, ranges over 30 days, and reversed durations", () => {
    expect(() =>
      parseLogsQuery(
        "http://ops.test/api/logs?from=2026-08-27T00%3A00%3A00Z&to=2026-08-26T00%3A00%3A00Z",
      ),
    ).toThrow();
    expect(() =>
      parseLogsQuery(
        "http://ops.test/api/logs?from=2026-07-01T00%3A00%3A00Z&to=2026-08-27T00%3A00%3A00Z",
      ),
    ).toThrow();
    expect(() =>
      parseLogsQuery("http://ops.test/api/logs?durationMin=100&durationMax=99"),
    ).toThrow();
  });

  it("rejects invalid methods and status classes", () => {
    expect(() =>
      parseLogsQuery("http://ops.test/api/logs?method=get"),
    ).toThrow();
    expect(() =>
      parseLogsQuery("http://ops.test/api/logs?statusClass=6xx"),
    ).toThrow();
  });
});
