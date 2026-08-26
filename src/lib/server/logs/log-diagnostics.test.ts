import { describe, expect, it } from "vitest";
import {
  sanitizeDiagnostic,
  sanitizeText,
} from "@/lib/server/logs/log-diagnostics";

describe("log diagnostic sanitization", () => {
  it("redacts credentials, identity values, IPs, emails, and URLs", () => {
    const result = sanitizeDiagnostic({
      message:
        "authorization=Bearer abc token=hunter2 userId=person-42 dev@example.com 10.1.2.3 https://example.test/path?q=secret /home/deploy/private/file.ts",
      stack: "Error\n    at run (/srv/ops/src/jobs/run.ts:12:4)",
    });
    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /abc|hunter2|person-42|dev@example|10\.1\.2\.3|example\.test|\/srv\/ops/,
    );
    expect(result?.redactionCount).toBeGreaterThanOrEqual(6);
  });

  it("keeps repository-relative V8 frames and discards unparseable or host-only frames", () => {
    const result = sanitizeDiagnostic({
      message: "failed",
      stack: [
        "Error: failed",
        "garbage containing private data",
        "    at handler (/home/deploy/app/src/api/handler.ts:20:7)",
        "    at external (/home/deploy/vendor/private.js:2:1)",
        "    at node:internal/process/task_queues:95:5",
      ].join("\n"),
    });
    expect(result?.frames).toEqual([
      { function: "handler", file: "src/api/handler.ts", line: 20, column: 7 },
      { file: "node:internal/process/task_queues", line: 95, column: 5 },
    ]);
  });

  it("has a stable fingerprint across host paths and redacted values", () => {
    const first = sanitizeDiagnostic({
      message: "token=first",
      stack: "Error\n at run (/one/src/run.ts:1:2)",
    });
    const second = sanitizeDiagnostic({
      message: "token=second",
      stack: "Error\n at run (/two/src/run.ts:1:2)",
    });
    expect(first?.fingerprint).toBe(second?.fingerprint);
  });

  it("limits messages, frames, and cause depth", () => {
    const stack = [
      "Error",
      ...Array.from(
        { length: 60 },
        (_, index) => ` at f${index} (/srv/src/f${index}.ts:1:1)`,
      ),
    ].join("\n");
    const result = sanitizeDiagnostic({
      message: `line one\n${"x".repeat(3_000)}`,
      stack,
      cause: {
        message: "one",
        cause: {
          message: "two",
          cause: { message: "three", cause: { message: "four" } },
        },
      },
    });
    expect(result?.message.length).toBe(2_048);
    expect(result?.message).toContain("\n");
    expect(result?.frames).toHaveLength(50);
    expect(result?.cause?.cause?.cause?.cause).toBeUndefined();
  });

  it("returns no diagnostic for malformed non-object errors and sanitizes base messages", () => {
    expect(sanitizeDiagnostic("raw secret")).toBeNull();
    expect(
      sanitizeDiagnostic({ name: "HttpServerError", code: "HTTP_500" }),
    ).toBeNull();
    const safe = sanitizeText("cookie=session-value");
    expect(safe.value).toBe("[REDACTED]");
    expect(safe.redactionCount).toBe(1);
  });
});
