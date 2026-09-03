import { describe, expect, it } from "vitest";
import { check, inviteEmailSchema, tokenSchema } from "./schemas";

describe("inviteEmailSchema", () => {
  it("accepts a plain email", () => {
    const result = check(inviteEmailSchema, { email: "partner@example.com" });
    expect(result.ok).toBe(true);
  });

  it("rejects something that is not an email", () => {
    const result = check(inviteEmailSchema, { email: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing email field", () => {
    const result = check(inviteEmailSchema, {});
    expect(result.ok).toBe(false);
  });
});

describe("tokenSchema", () => {
  it("accepts the hex shape create_invite actually produces", () => {
    const result = check(tokenSchema, "a1b2c3d4e5f60718293a4b5c6d7e8f90");
    expect(result.ok).toBe(true);
  });

  it("rejects a token with disallowed characters", () => {
    const result = check(tokenSchema, "../../etc/passwd");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty token", () => {
    const result = check(tokenSchema, "");
    expect(result.ok).toBe(false);
  });
});
