import { describe, expect, it } from "vitest";
import { buildAlertCondition } from "@/lib/server/alerts/alert-engine";
import {
  DEFAULT_ALERT_RULES,
  type AlertRule,
} from "@/lib/server/alerts/alert-types";
import {
  alertRuleInputSchema,
  effectiveRule,
} from "@/lib/server/alerts/alert-rules";

function rule(key: AlertRule["ruleKey"]): AlertRule {
  const found = DEFAULT_ALERT_RULES.find((item) => item.ruleKey === key);
  if (!found) throw new Error("missing fixture");
  return { ...found, updatedBy: "test", updatedAt: new Date(0).toISOString() };
}

describe("alert thresholds", () => {
  it("fires at the inclusive threshold", () => {
    expect(buildAlertCondition(rule("host_cpu"), 90, true, "CPU").active).toBe(
      true,
    );
  });
  it("does not fire below threshold or without eligibility", () => {
    expect(
      buildAlertCondition(rule("host_cpu"), 89.99, true, "CPU").active,
    ).toBe(false);
    expect(buildAlertCondition(rule("host_cpu"), 99, false, "CPU").active).toBe(
      false,
    );
    expect(
      buildAlertCondition(rule("host_cpu"), null, true, "CPU").active,
    ).toBe(false);
  });
});

describe("alert rule configuration", () => {
  it("prefers a service override to the global default", () => {
    const global = rule("http_5xx_rate");
    const override = { ...global, target: "coursehub-backend", threshold: 10 };
    expect(
      effectiveRule([global, override], "http_5xx_rate", "coursehub-backend")
        ?.threshold,
    ).toBe(10);
  });
  it("rejects infrastructure rules targeting a service", () => {
    const host = rule("host_cpu");
    expect(() =>
      alertRuleInputSchema.parse({
        ...host,
        target: "coursehub-backend",
        updatedBy: undefined,
        updatedAt: undefined,
      }),
    ).toThrow();
  });
  it("rejects service rules targeting an unknown service", () => {
    const service = rule("http_5xx_rate");
    expect(() =>
      alertRuleInputSchema.parse({
        ...service,
        target: "unknown",
        updatedBy: undefined,
        updatedAt: undefined,
      }),
    ).toThrow();
  });
});
