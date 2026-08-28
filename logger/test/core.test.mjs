import test from "node:test";
import assert from "node:assert/strict";
import { createOpsLogger } from "../dist/index.js";
import {
  validateLogEventV1,
  validateMetricEventV1,
} from "@coding-club-iitg/ops-contract";

const config = (overrides = {}) => ({
  project: "ccw",
  service: "ccw-web",
  ingestionUrl: "https://ops.example/api/ingest/logs",
  secret: "test-secret",
  enabled: true,
  console: { debug() {}, info() {}, warn() {}, error() {} },
  ...overrides,
});

test("all levels are local and warn+ are exported by default", async () => {
  const local = [];
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  };
  const logger = createOpsLogger(
    config({
      console: Object.fromEntries(
        ["debug", "info", "warn", "error"].map((k) => [
          k,
          (value) => local.push(JSON.parse(value)),
        ]),
      ),
    }),
  );
  for (const level of ["debug", "info", "warn", "error", "fatal"])
    logger[level](`level-${level}`);
  await logger.flush();
  assert.equal(local.length, 5);
  assert.deepEqual(
    sent.map((event) => event.level),
    ["warn", "error", "fatal"],
  );
  for (const event of sent)
    assert.equal(validateLogEventV1(event).success, true);
});

test("serializes credentials safely while preserving diagnostic context", async () => {
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(null, { status: 202 });
  };
  const cause = new Error("password=supersecret at /home/person/private.ts");
  const error = new Error("user@example.com failed", { cause });
  error.code = "E_FAIL";
  cause.cause = error;
  createOpsLogger(config()).error("token=abc", {
    error,
    attributes: {
      operation: "assign-mess",
      unsafe: "raw",
      dependency: "mongodb",
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    validateLogEventV1(
      Object.fromEntries(
        Object.entries(body).filter(
          ([key]) => key !== "error" || !body.error.message,
        ),
      ),
    ).success,
    true,
  );
  assert.equal(body.attributes.unsafe, undefined);
  assert.match(JSON.stringify(body), /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(body), /supersecret/);
  assert.match(JSON.stringify(body), /user@example|\/home\/person/);
  assert.equal(body.error.code, "E_FAIL");
  assert.ok(body.error.cause.cause);
});

test("preserves context for primitive error diagnostics", async () => {
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(null, { status: 202 });
  };
  const logger = createOpsLogger(config());
  logger.error("Operation failed", {
    error: "user@example.com at /home/person/job.ts token=secret-value",
  });
  await logger.flush();
  assert.match(body.error.message, /user@example\.com|\/home\/person\/job\.ts/);
  assert.doesNotMatch(body.error.message, /secret-value/);
});

test("metrics default to one, use their own endpoint, and stay out of the console", async () => {
  const local = [];
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({
      url: String(url),
      body: JSON.parse(init.body),
      authorization: init.headers.authorization,
    });
    return new Response(null, { status: 202 });
  };
  const logger = createOpsLogger(
    config({
      console: {
        debug: (value) => local.push(value),
        info: (value) => local.push(value),
        warn: (value) => local.push(value),
        error: (value) => local.push(value),
      },
    }),
  );
  logger.metric("course.view", {
    dimensions: { courseCode: "CS101", studentYear: 2 },
  });
  await logger.flush();
  assert.equal(local.length, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/api\/ingest\/metrics$/);
  assert.equal(sent[0].body.value, 1);
  assert.equal(sent[0].authorization, "Bearer test-secret");
  assert.equal(validateMetricEventV1(sent[0].body).success, true);
  assert.deepEqual(sent[0].body.dimensions, {
    courseCode: "CS101",
    studentYear: 2,
  });
});

test("metric delivery respects backpressure and rejects credential dimensions", async () => {
  let resolve;
  globalThis.fetch = () =>
    new Promise((done) => {
      resolve = done;
    });
  const logger = createOpsLogger(config({ maxInFlight: 1 }));
  logger.metric("course.view");
  logger.metric("course.view");
  logger.metric("course.view", { dimensions: { apiKey: "forbidden" } });
  assert.deepEqual(logger.deliveryStatus(), { pending: 1, dropped: 2 });
  resolve(new Response(null, { status: 202 }));
  await logger.flush();
});

test("disabled mode stays local and delivery failures are counted", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("offline");
  };
  const disabled = createOpsLogger(config({ enabled: false }));
  disabled.error("local");
  await disabled.flush();
  assert.equal(calls, 0);
  assert.deepEqual(disabled.deliveryStatus(), { pending: 0, dropped: 0 });
  const logger = createOpsLogger(config());
  logger.warn("send");
  await logger.flush();
  assert.deepEqual(logger.deliveryStatus(), { pending: 0, dropped: 1 });
});

test("in-flight bound drops overflow and flush waits", async () => {
  let resolve;
  globalThis.fetch = () =>
    new Promise((r) => {
      resolve = r;
    });
  const logger = createOpsLogger(config({ maxInFlight: 1 }));
  logger.error("one");
  logger.error("two");
  assert.deepEqual(logger.deliveryStatus(), { pending: 1, dropped: 1 });
  resolve(new Response(null, { status: 202 }));
  await logger.flush();
  assert.equal(logger.deliveryStatus().pending, 0);
});

test("invalid config is rejected", () => {
  assert.throws(
    () => createOpsLogger({ ...config(), enabled: undefined }),
    /enabled/,
  );
  assert.throws(
    () => createOpsLogger(config({ ingestionUrl: "/relative" })),
    /ingestionUrl/,
  );
  assert.throws(() =>
    createOpsLogger(config({ project: "habit", service: "ccw-web" })),
  );
});

test("timeout and non-202 delivery are contained", async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  const rejected = createOpsLogger(config());
  rejected.error("unavailable");
  await rejected.flush();
  assert.equal(rejected.deliveryStatus().dropped, 1);
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
    );
  const timed = createOpsLogger(config({ timeoutMs: 5 }));
  timed.error("timeout");
  await timed.flush();
  assert.equal(timed.deliveryStatus().dropped, 1);
});
