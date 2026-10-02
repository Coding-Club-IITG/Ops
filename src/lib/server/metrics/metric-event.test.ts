import { describe, expect, it } from "vitest";
import { parseProjectMetricEvent } from "@/lib/server/metrics/metric-event";

const event = {
  schemaVersion: 1,
  eventId: "page-view-1",
  timestamp: "2026-10-02T00:00:00.000Z",
  project: "ccw",
  service: "ccw-web",
  name: "web.page_view",
  value: 1,
  dimensions: { visitorKey: "a".repeat(64), page: "/blog/hello-world" },
};

describe("visitor metric validation", () => {
  it("accepts public page metrics using the existing metric envelope", () => {
    expect(parseProjectMetricEvent(event)).toEqual(event);
  });
  it.each([
    "127.0.0.1",
    "person@example.com",
    "raw-browser-id",
    123,
    "a".repeat(65),
  ])("rejects unsafe visitor keys: %s", (visitorKey) => {
    expect(() =>
      parseProjectMetricEvent({
        ...event,
        dimensions: { ...event.dimensions, visitorKey },
      }),
    ).toThrow();
  });
  it.each([
    "/?token=secret",
    "/blog#section",
    "https://example.com",
    "//example.com",
    "/../../internal",
    "/blog/private%20value",
  ])("rejects noncanonical paths: %s", (page) => {
    expect(() =>
      parseProjectMetricEvent({
        ...event,
        dimensions: { ...event.dimensions, page },
      }),
    ).toThrow();
  });
  it("requires a key, a unit value, and only approved page dimensions", () => {
    expect(() =>
      parseProjectMetricEvent({ ...event, dimensions: { page: "/" } }),
    ).toThrow();
    expect(() => parseProjectMetricEvent({ ...event, value: 20 })).toThrow();
    expect(() =>
      parseProjectMetricEvent({
        ...event,
        dimensions: { ...event.dimensions, email: "person@example.com" },
      }),
    ).toThrow();
  });
});
