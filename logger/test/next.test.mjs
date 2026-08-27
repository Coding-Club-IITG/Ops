import test from "node:test";
import assert from "node:assert/strict";
import { createNextOpsLogger } from "../dist/next.js";

const cfg = {
  project: "ccw",
  service: "ccw-web",
  ingestionUrl: "https://ops.example/ingest",
  secret: "x",
  enabled: true,
  console: { debug() {}, info() {}, warn() {}, error() {} },
};
const span = (attributes, overrides = {}) => ({
  attributes,
  duration: [0, 25_000_000],
  spanContext: () => ({ traceId: "0123456789abcdef0123456789abcdef" }),
  ...overrides,
});

test("maps only completed allow-listed API request spans", async () => {
  const sent = [];
  globalThis.fetch = async (_u, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  };
  const { logger, spanProcessor } = createNextOpsLogger(cfg);
  spanProcessor.onEnd(
    span({
      "next.span_type": "BaseServer.handleRequest",
      "next.route": "/api/items/[id]",
      "http.request.method": "GET",
      "http.response.status_code": 500,
      unsafe: { request: true },
    }),
  );
  spanProcessor.onEnd(
    span({
      "next.span_type": "BaseServer.handleRequest",
      "next.route": "/page",
      "http.request.method": "GET",
      "http.response.status_code": 500,
    }),
  );
  spanProcessor.onEnd(
    span({
      "next.span_type": "AppRouteRouteHandlers.runHandler",
      "next.route": "/api/items/[id]",
      "http.request.method": "GET",
      "http.response.status_code": 500,
    }),
  );
  spanProcessor.onEnd(
    span({
      "next.span_type": "BaseServer.handleRequest",
      "next.route": "/api/items/private?token=x",
      "http.request.method": "GET",
      "http.response.status_code": 500,
    }),
  );
  await logger.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].correlationId, "0123456789abcdef0123456789abcdef");
  assert.equal(sent[0].http.route, "/api/items/[id]");
  assert.equal(sent[0].unsafe, undefined);
});
