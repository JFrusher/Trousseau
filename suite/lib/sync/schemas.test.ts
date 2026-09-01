import { expect, test } from "vitest";
import { MAX_SLICES_PER_PUSH } from "./handlers";
import { blobSchema, check, createSchema, params, pushSchema, shareSchema } from "./schemas";

const sealed = { ciphertext: "AAAA", iv: "BBBB" };
const create = { id: "abc_DEF-123", salt: "AAAA", authHash: "BBBB" };

test("a well-formed create passes", () => {
  expect(check(createSchema, create).ok).toBe(true);
});

/**
 * The three that used to reach a handler. Each was a cast, so each was a
 * promise to TypeScript and nothing at runtime.
 */

test("a null body is refused rather than throwing a TypeError", () => {
  // `(null).id` threw, which surfaced as a 500 with a stack trace.
  const result = check(createSchema, null);
  expect(result.ok).toBe(false);
});

test("an array body is refused", () => {
  expect(check(createSchema, []).ok).toBe(false);
});

test("a non-integer expectedVersion is refused before it reaches Postgres", () => {
  // Typed `integer` in the database, and never checked anywhere before this.
  const result = check(pushSchema, {
    writes: [{ slice: "guests", sealed, expectedVersion: "banana" }],
  });
  expect(result.ok).toBe(false);
  expect(result.ok === false && result.error).toContain("expectedVersion");
});

test("a negative expectedVersion is refused", () => {
  const result = check(pushSchema, {
    writes: [{ slice: "guests", sealed, expectedVersion: -1 }],
  });
  expect(result.ok).toBe(false);
});

test("a wedding id of unbounded length is refused", () => {
  expect(check(createSchema, { ...create, id: "a".repeat(500) }).ok).toBe(false);
});

test("a wedding id outside base64url is refused", () => {
  // What would otherwise go straight into a primary key.
  expect(check(createSchema, { ...create, id: "../../etc/passwd" }).ok).toBe(false);
});

test("ciphertext that is not base64 is refused", () => {
  const result = check(pushSchema, {
    writes: [{ slice: "guests", sealed: { ciphertext: "not base64!", iv: "AAAA" }, expectedVersion: 0 }],
  });
  expect(result.ok).toBe(false);
});

test("more slices than the ceiling is refused", () => {
  const one = { slice: "guests", sealed, expectedVersion: 0 };
  const result = check(pushSchema, {
    writes: Array.from({ length: MAX_SLICES_PER_PUSH + 1 }, () => one),
  });
  expect(result.ok).toBe(false);
});

test("exactly the ceiling is allowed", () => {
  const one = { slice: "guests", sealed, expectedVersion: 0 };
  const result = check(pushSchema, {
    writes: Array.from({ length: MAX_SLICES_PER_PUSH }, () => one),
  });
  expect(result.ok).toBe(true);
});

test("an unknown field on a create is refused rather than ignored", () => {
  expect(check(createSchema, { ...create, isAdmin: true }).ok).toBe(false);
});

test("a share needs both halves", () => {
  expect(check(shareSchema, { token: "abc123" }).ok).toBe(false);
  expect(check(shareSchema, { token: "abc123", sealed }).ok).toBe(true);
});

test("a blob body needs its sealed bytes", () => {
  expect(check(blobSchema, {}).ok).toBe(false);
  expect(check(blobSchema, { sealed }).ok).toBe(true);
});

/** Asset ids carry filenames, so they cannot be narrowed to hex. */

test("an asset id keeps the spaces and dots a filename needs", () => {
  expect(check(params.blobId, "img:my photo.png:12345").ok).toBe(true);
  expect(check(params.blobId, "font:sha256-0a1b2c3d").ok).toBe(true);
});

test("an asset id may not carry a separator into another route segment", () => {
  expect(check(params.blobId, "img:../../secret").ok).toBe(false);
  expect(check(params.blobId, "img:a\\b").ok).toBe(false);
});

test("an asset id may not carry control characters", () => {
  // Written as char codes rather than literals: a raw control byte in a source
  // file is invisible in review and does not survive tooling reliably.
  const tab = String.fromCharCode(0x09);
  const del = String.fromCharCode(0x7f);
  expect(check(params.blobId, `img:a${tab}b`).ok).toBe(false);
  expect(check(params.blobId, `img:a${del}b`).ok).toBe(false);
});

test("an empty path segment is refused", () => {
  expect(check(params.weddingId, "").ok).toBe(false);
  expect(check(params.weddingId, undefined).ok).toBe(false);
});
