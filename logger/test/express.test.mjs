import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createExpressOpsLogger } from "../dist/express.js";

const cfg = {
  project: "habit",
  service: "hab-gateway",
  ingestionUrl: "https://ops.example/ingest",
  secret: "x",
  enabled: true,
  console: { debug() {}, info() {}, warn() {}, error() {} },
};

test("concurrent requests have distinct generated correlation IDs", async () => {
  const sent = [];
  globalThis.fetch = async (_u, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  };
  const { logger, middleware } = createExpressOpsLogger(cfg);
  const run = (delay) =>
    new Promise((resolve) => {
      const res = new EventEmitter();
      res.statusCode = 500;
      res.removeListener = res.removeListener.bind(res);
      middleware(
        {
          method: "GET",
          route: { path: "/api/items/:id" },
          url: "/api/items/private?token=x",
        },
        res,
        () => {
          setTimeout(() => {
            logger.warn("request warning");
            res.emit("finish");
            resolve();
          }, delay);
        },
      );
    });
  await Promise.all([run(5), run(0)]);
  await logger.flush();
  const app = sent.filter((e) => e.kind === "application");
  const http = sent.filter((e) => e.kind === "http");
  assert.equal(app.length, 2);
  assert.equal(http.length, 2);
  assert.equal(new Set(app.map((e) => e.correlationId)).size, 2);
  for (const event of app)
    assert.ok(http.some((item) => item.correlationId === event.correlationId));
  assert.doesNotMatch(JSON.stringify(sent), /private|token=x/);
});

test("unsafe and unmatched route data uses a fixed fallback", async () => {
  const sent = [];
  globalThis.fetch = async (_u, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  };
  const { logger, middleware } = createExpressOpsLogger(cfg);
  const res = new EventEmitter();
  res.statusCode = 404;
  middleware({ method: "GET", url: "/secret/value?email=a@b.com" }, res, () =>
    res.emit("finish"),
  );
  await logger.flush();
  assert.equal(sent[0].http.route, "unmatched");
});
