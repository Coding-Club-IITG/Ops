import { describe, expect, it } from "vitest";
import {
  extractEventPayload,
  getDeliveryCount,
  parseStreamReply,
} from "@/worker/stream-protocol";

describe("Redis stream protocol", () => {
  it("parses stream fields without coercing payloads", () => {
    expect(
      parseStreamReply([
        ["ops:logs:v1", [["1-0", ["event", '{"schemaVersion":1}']]]],
      ]),
    ).toEqual([{ id: "1-0", fields: { event: '{"schemaVersion":1}' } }]);

    expect(
      parseStreamReply({
        "ops:logs:v1": [["2-0", ["event", '{"schemaVersion":1}']]],
      }),
    ).toEqual([{ id: "2-0", fields: { event: '{"schemaVersion":1}' } }]);
  });

  it("reads delivery counts and requires the event field", () => {
    expect(getDeliveryCount([["1-0", "consumer", 10, 5]])).toBe(5);
    expect(() => extractEventPayload({ id: "1-0", fields: {} })).toThrow();
  });
});
