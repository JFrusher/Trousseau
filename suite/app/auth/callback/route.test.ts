import { describe, expect, it } from "vitest";
import { sameOriginPath } from "./route";

const origin = "https://good.example";

describe("sameOriginPath", () => {
  it("passes through a normal same-site path unchanged", () => {
    expect(sameOriginPath("/invite/abc123", origin)).toBe("/invite/abc123");
  });

  it("keeps the query and hash of a same-site path", () => {
    expect(sameOriginPath("/account?tab=1#top", origin)).toBe("/account?tab=1#top");
  });

  it("falls back to /account when next is missing", () => {
    expect(sameOriginPath(null, origin)).toBe("/account");
  });

  it("rejects a protocol-relative URL", () => {
    expect(sameOriginPath("//evil.com", origin)).toBe("/account");
  });

  it("rejects the backslash bypass that a prefix-regex guard would miss", () => {
    // new URL() normalises \ to / for http/https before parsing, so this
    // resolves to https://evil.com/ even though it starts with a single "/".
    expect(sameOriginPath("/\\evil.com", origin)).toBe("/account");
    expect(sameOriginPath("/\\/evil.com", origin)).toBe("/account");
  });

  it("rejects an absolute URL to a different origin", () => {
    expect(sameOriginPath("https://evil.com/", origin)).toBe("/account");
  });

  it("rejects an absolute URL to the same origin but a different scheme/port (still an origin mismatch)", () => {
    expect(sameOriginPath("http://good.example", origin)).toBe("/account");
  });
});
