import { describe, expect, it, vi } from "vitest";
import { sentryOrigin, supabaseOrigin } from "./next.config";

describe("sentryOrigin", () => {
  it("returns null when no DSN is set", () => {
    expect(sentryOrigin(undefined)).toBeNull();
  });

  it("derives the origin from a real DSN", () => {
    expect(sentryOrigin("https://abc123@o0.ingest.sentry.io/1")).toBe("https://o0.ingest.sentry.io");
  });

  it("returns null for an unparseable DSN rather than throwing", () => {
    expect(sentryOrigin("not-a-url")).toBeNull();
  });
});

describe("supabaseOrigin", () => {
  it("returns null when accounts are not configured", () => {
    expect(supabaseOrigin(undefined)).toBeNull();
  });

  it("derives the origin from a real Supabase project URL", () => {
    expect(supabaseOrigin("https://divyddjzzibhayssmgll.supabase.co")).toBe(
      "https://divyddjzzibhayssmgll.supabase.co",
    );
  });

  it("returns null for an unparseable URL rather than throwing", () => {
    expect(supabaseOrigin("not-a-url")).toBeNull();
  });
});

describe("the content security policy", () => {
  it("includes connect-src to Supabase when accounts are configured", async () => {
    // next.config.ts computes `contentSecurityPolicy` once, at module load,
    // by calling env() — a static import of this test file would have run
    // before these vars were set. resetModules() makes the import below
    // re-evaluate both next.config.ts and the lib/env.ts it imports from
    // scratch, rather than reusing either from vitest's module cache — the
    // fresh lib/env.ts starts with its own memoisation cleared, so it reads
    // process.env as set just below, not a value some earlier test saw.
    vi.resetModules();
    process.env.SUPABASE_URL = "https://placeholder.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-role-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://divyddjzzibhayssmgll.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "placeholder-anon-key";
    const { contentSecurityPolicy } = await import("./next.config");
    expect(contentSecurityPolicy).toContain("https://divyddjzzibhayssmgll.supabase.co");
  });
});
