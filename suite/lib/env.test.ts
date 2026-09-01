import { expect, test } from "vitest";
import { parseEnv } from "./env";

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
