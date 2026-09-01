import { expect, test } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "../next.config";

const value = (key: string) => securityHeaders.find((header) => header.key === key)?.value;

test("every header we rely on is present", () => {
  // A list rather than individual assertions, so dropping one fails here rather
  // than going unnoticed until somebody curls the deployment.
  for (const key of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    expect(value(key), `${key} is missing`).toBeDefined();
  }
});

test("the browser may talk to this origin and nowhere else", () => {
  // The directive this policy is actually for: a guest list cannot be sent
  // somewhere else, whatever else goes wrong.
  expect(contentSecurityPolicy).toContain("connect-src 'self'");
});

test("plugins and framing are refused outright", () => {
  expect(contentSecurityPolicy).toContain("object-src 'none'");
  expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
  expect(contentSecurityPolicy).toContain("base-uri 'self'");
  expect(value("X-Frame-Options")).toBe("DENY");
});

test("blob and data URLs are allowed only where the tools need them", () => {
  // PDF previews and uploaded artwork come back out of IndexedDB as object
  // URLs; nothing else should be able to load from them.
  expect(contentSecurityPolicy).toContain("img-src 'self' blob: data:");
  expect(contentSecurityPolicy).toContain("worker-src 'self' blob:");
  expect(contentSecurityPolicy).not.toContain("default-src 'self' blob:");
});

test("eval is never allowed in a production build", () => {
  // `NODE_ENV` is "test" here, which is not "development" — the same branch a
  // production build takes.
  expect(contentSecurityPolicy).not.toContain("unsafe-eval");
});

test("HSTS is stated by the app rather than left to the host", () => {
  expect(value("Strict-Transport-Security")).toContain("max-age=63072000");
  expect(value("Strict-Transport-Security")).toContain("includeSubDomains");
});
