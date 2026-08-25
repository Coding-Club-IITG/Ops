import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  LOG_EVENT_ATTRIBUTE_KEYS,
  LogEventV1ValidationError,
  isSafeRouteTemplate,
  parseLogEventV1,
  validateLogEventV1,
} from "./log-event-v1.js";
import { LOG_EVENT_PROJECT_REGISTRY } from "./project-registry.js";

const CONTRACT_DIR = dirname(fileURLToPath(import.meta.url));

async function loadFixtures(kind: "valid" | "invalid") {
  const directory = join(CONTRACT_DIR, "fixtures", kind);
  const filenames = (await readdir(directory)).filter((name) =>
    name.endsWith(".json"),
  );
  return Promise.all(
    filenames.map(async (filename) => ({
      filename,
      value: JSON.parse(
        await readFile(join(directory, filename), "utf8"),
      ) as unknown,
    })),
  );
}

test("all producer acceptance fixtures implement exactly LogEventV1", async () => {
  const fixtures = await loadFixtures("valid");
  assert.ok(fixtures.length >= 4);

  for (const fixture of fixtures) {
    const result = validateLogEventV1(fixture.value);
    assert.equal(
      result.success,
      true,
      `${fixture.filename}: ${result.success ? "" : JSON.stringify(result.issues)}`,
    );
  }
});

test("the project registry has unique projects and globally unique services", () => {
  const projectIds = LOG_EVENT_PROJECT_REGISTRY.map((project) => project.id);
  const serviceIds = LOG_EVENT_PROJECT_REGISTRY.flatMap((project) =>
    project.services.map((service) => service.id),
  );

  assert.equal(new Set(projectIds).size, projectIds.length);
  assert.equal(new Set(serviceIds).size, serviceIds.length);
  assert.ok(
    LOG_EVENT_PROJECT_REGISTRY.every(
      (project) => project.name.length > 0 && project.services.length > 0,
    ),
  );
});

test("unsafe and contract-divergent fixtures are rejected without coercion", async () => {
  const fixtures = await loadFixtures("invalid");
  assert.ok(fixtures.length >= 7);

  for (const fixture of fixtures) {
    const result = validateLogEventV1(fixture.value);
    assert.equal(
      result.success,
      false,
      `${fixture.filename} unexpectedly passed`,
    );
  }
});

test("validation never strips unknown input fields", () => {
  const result = validateLogEventV1({
    schemaVersion: "1",
    requestBody: { password: "secret" },
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.issues.some((issue) => issue.path === "requestBody"));
    assert.ok(result.issues.some((issue) => issue.path === "schemaVersion"));
  }
});

test("parse throws structured issues for dead-letter handling", () => {
  assert.throws(
    () => parseLogEventV1(null),
    (error: unknown) =>
      error instanceof LogEventV1ValidationError &&
      error.issues[0]?.path === "",
  );
});

test("route validation accepts templates and rejects raw URL data", () => {
  assert.equal(isSafeRouteTemplate("/api/v2/activities/:activityId"), true);
  assert.equal(isSafeRouteTemplate("/api/projects/[projectId]"), true);
  assert.equal(isSafeRouteTemplate("/api/files/[...path]"), true);
  assert.equal(isSafeRouteTemplate("/api/users/12345"), false);
  assert.equal(
    isSafeRouteTemplate("/api/users?email=person@example.com"),
    false,
  );
  assert.equal(isSafeRouteTemplate("https://codingclub.in/api"), false);
});

test("the V1 attribute allowlist excludes identity and transport fields", () => {
  const keys: readonly string[] = LOG_EVENT_ATTRIBUTE_KEYS;
  for (const forbidden of [
    "body",
    "headers",
    "ip",
    "userAgent",
    "userId",
    "email",
    "token",
    "password",
  ]) {
    assert.equal(keys.includes(forbidden), false);
  }
});

test("timestamps are real UTC instants, not merely date-shaped strings", () => {
  const project = LOG_EVENT_PROJECT_REGISTRY[0];
  const service = project.services[0];
  const result = validateLogEventV1({
    schemaVersion: 1,
    eventId: "invalid-date",
    timestamp: "2026-02-31T10:15:30Z",
    project: project.id,
    service: service.id,
    environment: "production",
    kind: "application",
    level: "info",
    message: "Worker started",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.issues.some((issue) => issue.path === "timestamp"));
  }
});
