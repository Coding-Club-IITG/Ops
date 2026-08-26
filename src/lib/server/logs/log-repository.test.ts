import { describe, expect, it } from "vitest";
import { serializeDiagnosticJson } from "@/lib/server/logs/log-repository";

describe("diagnostic PostgreSQL serialization", () => {
  it("encodes frames and causes as JSON rather than PostgreSQL arrays", () => {
    const serialized = serializeDiagnosticJson({
      message: "Synthetic failure",
      frames: [{ function: "run", file: "src/worker.ts", line: 10, column: 2 }],
      cause: {
        name: "DependencyError",
        message: "Dependency failed",
        frames: [{ file: "src/dependency.ts", line: 4, column: 1 }],
      },
      fingerprint: "a".repeat(64),
      redactionCount: 1,
    });

    expect(JSON.parse(serialized.frames)).toEqual([
      { function: "run", file: "src/worker.ts", line: 10, column: 2 },
    ]);
    expect(JSON.parse(serialized.cause ?? "null")).toMatchObject({
      name: "DependencyError",
      message: "Dependency failed",
    });
  });

  it("stores a missing cause as SQL null", () => {
    const serialized = serializeDiagnosticJson({
      message: "Synthetic failure",
      frames: [],
      fingerprint: "b".repeat(64),
      redactionCount: 0,
    });
    expect(serialized.frames).toBe("[]");
    expect(serialized.cause).toBeNull();
  });
});
