import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "@/lib/eligibility";
import { operatorGrantInputSchema } from "@/lib/server/operator-grants";

describe("Ops operator eligibility", () => {
  it.each(["viewer", "admin"] as const)(
    "accepts an enabled %s grant",
    (role) => {
      expect(
        evaluateEligibility(
          { id: "1", email: "Operator@Example.test" },
          { email: "operator@example.test", role, enabled: true },
        ),
      ).toEqual({ id: "1", email: "operator@example.test", role });
    },
  );

  it("fails closed for missing, disabled, mismatched, and unknown grants", () => {
    const user = { id: "1", email: "operator@example.test" };

    expect(evaluateEligibility(user, null)).toBeNull();
    expect(
      evaluateEligibility(user, {
        email: user.email,
        role: "viewer",
        enabled: false,
      }),
    ).toBeNull();
    expect(
      evaluateEligibility(user, {
        email: "someone-else@example.test",
        role: "admin",
        enabled: true,
      }),
    ).toBeNull();
    expect(
      evaluateEligibility(user, {
        email: user.email,
        role: "owner",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("normalizes and validates operator grant input", () => {
    expect(
      operatorGrantInputSchema.parse({
        email: "Admin@Example.test",
        role: "admin",
      }),
    ).toEqual({
      email: "admin@example.test",
      role: "admin",
      enabled: true,
    });
    expect(() =>
      operatorGrantInputSchema.parse({ email: "invalid", role: "admin" }),
    ).toThrow();
  });
});
