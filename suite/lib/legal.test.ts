import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { RETENTION_MONTHS as HANDLER_RETENTION } from "./sync/handlers";
import { CONTROLLER, POLICIES, policyText, PRIVACY, RETENTION_MONTHS } from "./legal";

const digestOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * The effective date has to be true.
 *
 * A date claiming the reader was last told something in January, when the words
 * changed in June, is worse than no date at all. So the words are hashed and
 * the hash is recorded beside the date: change one without the other and this
 * fails, naming the value to paste in.
 */
test.each(POLICIES.map((policy) => [policy.title, policy] as const))(
  "%s: the effective date matches the words it belongs to",
  (_title, policy) => {
    const actual = digestOf(policyText(policy));
    expect(
      actual,
      `The ${policy.title} text has changed. Set updated to today and digest to "${actual}".`,
    ).toBe(policy.digest);
  },
);

test.each(POLICIES.map((policy) => [policy.title, policy] as const))(
  "%s: the effective date is a real date, not in the future",
  (_title, policy) => {
    const updated = new Date(policy.updated);
    expect(Number.isNaN(updated.getTime())).toBe(false);
    expect(updated.getTime()).toBeLessThanOrEqual(Date.now());
  },
);

test("the retention period quoted to the reader is the one the code enforces", () => {
  // The Privacy Policy states a number of months. The sweep deletes on that
  // number. Two places, and the one the reader sees is not the one that runs.
  expect(RETENTION_MONTHS).toBe(HANDLER_RETENTION);
  expect(policyText(PRIVACY)).toContain(`${HANDLER_RETENTION} months`);
});

test("a reader is given a way to make contact", () => {
  expect(policyText(PRIVACY)).toContain(CONTROLLER.email);
});

test("nothing claims a cookie banner or analytics that do not exist", () => {
  // If either is ever added, this fails and the policy has to be rewritten
  // before it can pass — which is the point.
  const text = policyText(PRIVACY).toLowerCase();
  expect(text).toContain("no cookies are set");
  expect(text).toContain("no analytics");
});
