import { expect, test } from "vitest";
import { parseEnv, accountsConfigured, resetCache } from "./env";

const supabase = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

test("no backend at all is a supported deployment, not an error", () => {
  const env = parseEnv({ NODE_ENV: "production" });
  expect(env.SUPABASE_URL).toBeUndefined();
});

test("a full backend passes", () => {
  const env = parseEnv({ ...supabase, NODE_ENV: "production" });
  expect(env.SUPABASE_URL).toBe(supabase.SUPABASE_URL);
});

// The reason this file exists: half a backend used to be indistinguishable
// from none, and answered 501 rather than failing the build.
test("a URL with no key fails, naming the missing one", () => {
  expect(() => parseEnv({ SUPABASE_URL: supabase.SUPABASE_URL })).toThrow(
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test("a key with no URL fails, naming the missing one", () => {
  expect(() =>
    parseEnv({ SUPABASE_SERVICE_ROLE_KEY: supabase.SUPABASE_SERVICE_ROLE_KEY }),
  ).toThrow(/SUPABASE_URL/);
});

test("an emptied variable reads as absent, not as malformed", () => {
  // What a cleared dashboard field and a bare `KEY=` in a .env file both yield.
  // Rejected as an invalid URL, this sends you hunting a typo in a value that
  // is not there.
  expect(() => parseEnv({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" })).not.toThrow();
});

test("a half-configured pair is still caught when the other half is empty", () => {
  expect(() => parseEnv({ ...supabase, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test("the in-memory shim is refused in production", () => {
  expect(() => parseEnv({ ...supabase, SYNC_IN_MEMORY: "1", NODE_ENV: "production" })).toThrow(
    /SYNC_IN_MEMORY/,
  );
});

test("the in-memory shim is allowed in development", () => {
  const env = parseEnv({ SYNC_IN_MEMORY: "1", NODE_ENV: "development" });
  expect(env.SYNC_IN_MEMORY).toBe("1");
});

test("a malformed Supabase URL is rejected", () => {
  expect(() => parseEnv({ ...supabase, SUPABASE_URL: "project.supabase.co" })).toThrow(
    /SUPABASE_URL/,
  );
});

/**
 * What a real deployment actually got wrong. The build failed with "Invalid
 * URL", which named neither the mistake nor the fix.
 */

test("a bare Supabase host is refused, and the message says why", () => {
  // What the Supabase dashboard displays, and therefore what gets pasted.
  expect(() => parseEnv({ ...supabase, SUPABASE_URL: "xyz.supabase.co" })).toThrow(
    "must be a full URL including https://",
  );
});

test("a pasted trailing newline does not break an otherwise correct value", () => {
  // Invisible in every dashboard field, and fatal without trimming.
  // Written as a char code: a literal escape in this position is exactly the
  // invisible character the test is about, and does not survive editing well.
  const newline = String.fromCharCode(10);
  const env = parseEnv({
    SUPABASE_URL: `https://project.supabase.co${newline}`,
    SUPABASE_SERVICE_ROLE_KEY: "  service-role-key  ",
  });
  expect(env.SUPABASE_URL).toBe("https://project.supabase.co");
  expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-key");
});

test("whitespace alone reads as absent, not as a value", () => {
  const tab = String.fromCharCode(9);
  expect(() => parseEnv({ SUPABASE_URL: "   ", SUPABASE_SERVICE_ROLE_KEY: tab })).not.toThrow();
});

test("a bare Sentry DSN host is refused with the same guidance", () => {
  expect(() => parseEnv({ NEXT_PUBLIC_SENTRY_DSN: "o44.ingest.sentry.io/456" })).toThrow(
    "NEXT_PUBLIC_SENTRY_DSN",
  );
});

test("NEXT_PUBLIC_SUPABASE_ANON_KEY is optional, like the rest of Supabase config", () => {
  const result = parseEnv({ NODE_ENV: "production" });
  expect(result.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeUndefined();
});

test("accountsConfigured is false with no Supabase config", () => {
  resetCache();
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
  process.env.SUPABASE_URL = "";
  expect(accountsConfigured()).toBe(false);
});

test("accountsConfigured is true once SUPABASE_URL and the anon key are both set", () => {
  resetCache();
  process.env.NODE_ENV = "production";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-value";
  expect(accountsConfigured()).toBe(true);
});
