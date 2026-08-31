import { expect, test } from "vitest";
import {
  deriveKeys,
  importShareKey,
  newSalt,
  newShareKey,
  newWeddingId,
  seal,
  tokenHash,
  unseal,
} from "./crypto";

/**
 * The security properties, as tests.
 *
 * These are slow — PBKDF2 at 600,000 rounds is meant to be — and that is the
 * point. A test run that suddenly gets quick means somebody lowered the rounds.
 */

const SALT = newSalt();

test("the same passphrase and salt always give the same keys", async () => {
  const a = await deriveKeys("correct horse battery staple", SALT);
  const b = await deriveKeys("correct horse battery staple", SALT);
  expect(a.writeToken).toBe(b.writeToken);

  // And the content key really is the same one: what a seals, b unseals.
  const sealed = await seal(a.contentKey, { guest: "Charis" });
  expect(await unseal(b.contentKey, sealed)).toEqual({ guest: "Charis" });
});

test("a different passphrase gives entirely different keys", async () => {
  const a = await deriveKeys("correct horse battery staple", SALT);
  const b = await deriveKeys("correct horse battery stapler", SALT);
  expect(a.writeToken).not.toBe(b.writeToken);

  const sealed = await seal(a.contentKey, { guest: "Charis" });
  await expect(unseal(b.contentKey, sealed)).rejects.toThrow();
});

test("the same passphrase under a different salt gives different keys", async () => {
  const a = await deriveKeys("correct horse battery staple", SALT);
  const b = await deriveKeys("correct horse battery staple", newSalt());
  expect(a.writeToken).not.toBe(b.writeToken);
});

test("the write token cannot be used to decrypt anything", async () => {
  const { contentKey, writeToken } = await deriveKeys("correct horse battery staple", SALT);
  const sealed = await seal(contentKey, { dietary: "Coeliac" });

  // The token is what the server sees. Treating it as a key must not work.
  const asKey = await importShareKey(
    writeToken.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  );
  await expect(unseal(asKey, sealed)).rejects.toThrow();
});

test("what the server stores does not reveal the token", async () => {
  const { writeToken } = await deriveKeys("correct horse battery staple", SALT);
  const stored = await tokenHash(writeToken);
  expect(stored).not.toBe(writeToken);
  expect(stored).toHaveLength(44); // 32 bytes, base64
  // Deterministic, so the server can compare on the next write.
  expect(await tokenHash(writeToken)).toBe(stored);
});

test("every seal uses a fresh nonce", async () => {
  const { contentKey } = await deriveKeys("correct horse battery staple", SALT);
  const a = await seal(contentKey, { same: "value" });
  const b = await seal(contentKey, { same: "value" });

  // Reusing a nonce under one key leaks the XOR of the two plaintexts. Identical
  // input must still produce different bytes.
  expect(a.iv).not.toBe(b.iv);
  expect(a.ciphertext).not.toBe(b.ciphertext);
});

test("tampered ciphertext is refused, not silently mangled", async () => {
  const { contentKey } = await deriveKeys("correct horse battery staple", SALT);
  const sealed = await seal(contentKey, { table: "Table 4" });

  const bytes = atob(sealed.ciphertext).split("");
  bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 0x01);
  const tampered = { ...sealed, ciphertext: btoa(bytes.join("")) };

  await expect(unseal(contentKey, tampered)).rejects.toThrow();
});

test("a share key is independent of the passphrase", async () => {
  const { contentKey } = await deriveKeys("correct horse battery staple", SALT);
  const { key: shareKey, encoded } = await newShareKey();

  const forGuests = await seal(shareKey, { name: "Eleanor Vane", table: "Table 2" });
  // Whoever holds the couple's passphrase cannot read the guest share with it,
  // and — more to the point — the reverse is also true.
  await expect(unseal(contentKey, forGuests)).rejects.toThrow();

  // The link's fragment is enough on its own, and nothing else is.
  expect(await unseal(await importShareKey(encoded), forGuests)).toEqual({
    name: "Eleanor Vane",
    table: "Table 2",
  });
});

test("identifiers are long enough not to be guessed", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newWeddingId()));
  expect(ids.size).toBe(200);
  // 128 bits, base64url, unpadded.
  expect([...ids][0]).toHaveLength(22);
});

test("a share key survives a round trip through a URL fragment", async () => {
  const { encoded } = await newShareKey();
  const url = new URL(`https://example.test/s/abc#k=${encoded}`);
  expect(new URLSearchParams(url.hash.slice(1)).get("k")).toBe(encoded);
});
