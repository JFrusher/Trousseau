/**
 * End-to-end encryption for a shared wedding.
 *
 * The server stores ciphertext it cannot read. Guest names, email addresses,
 * dietary requirements and phone numbers never exist in plaintext outside the
 * couple's own machines — which is the condition Trousseau's README puts on
 * this data, and the reason its whole DVC arrangement exists.
 *
 * How the passphrase becomes two independent secrets:
 *
 *   passphrase + salt --PBKDF2--> master --HKDF--> content key   (stays here)
 *                                            \--> write token   (sent to server)
 *
 * The server stores only SHA-256 of the write token, so it can check that a
 * writer knows the passphrase without ever holding anything that decrypts the
 * document. The two derived secrets are independent because HKDF is expanded
 * with distinct info labels; learning the write token tells an attacker nothing
 * about the content key.
 *
 * Everything here is WebCrypto. No dependency, and the primitives are the
 * platform's rather than a library's.
 */

/**
 * PBKDF2 rounds. OWASP's 2023 floor for PBKDF2-HMAC-SHA256 is 600,000, and this
 * runs once per unlock rather than per request, so the cost lands in the right
 * place: about a second on a phone, and prohibitive at scale for a guessing
 * attack against a stolen database.
 */
const PBKDF2_ROUNDS = 600_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface WeddingKeys {
  /** AES-GCM key. Never leaves the browser, never sent anywhere. */
  contentKey: CryptoKey;
  /** Proves knowledge of the passphrase. The server keeps only its hash. */
  writeToken: string;
}

/** A fresh salt for a new wedding. Not secret — the server serves it to anyone. */
export function newSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** A wedding's public identifier. 128 bits, so it cannot be enumerated. */
export function newWeddingId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Turn a passphrase into the two secrets.
 *
 * Deliberately slow. If this ever feels fast, check `PBKDF2_ROUNDS` has not been
 * lowered to make a test quicker.
 */
export async function deriveKeys(passphrase: string, salt: string): Promise<WeddingKeys> {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const master = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromBase64(salt), iterations: PBKDF2_ROUNDS, hash: "SHA-256" },
    base,
    256,
  );

  const hkdf = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits", "deriveKey"]);

  const contentKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode("tableaux:content") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const tokenBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode("tableaux:auth") },
    hkdf,
    256,
  );

  return { contentKey, writeToken: toBase64(new Uint8Array(tokenBits)) };
}

/**
 * What the server stores in place of the write token.
 *
 * A plain SHA-256 rather than a password hash, because the token is already
 * 256 bits of PBKDF2 output — there is no low-entropy secret left to protect,
 * and a second slow hash would only cost the server time on every write.
 */
export async function tokenHash(writeToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", fromBase64(writeToken));
  return toBase64(new Uint8Array(digest));
}

export interface Sealed {
  /** Base64 ciphertext, with the GCM tag appended by WebCrypto. */
  ciphertext: string;
  /** Base64 nonce. Fresh for every seal — never reused under one key. */
  iv: string;
}

/**
 * Encrypt one slice.
 *
 * A fresh 96-bit nonce every time. Reusing one under the same key is the single
 * catastrophic mistake available with GCM: it leaks the XOR of two plaintexts
 * and destroys the authentication guarantee. Generated here rather than passed
 * in so no caller can supply a stale one.
 */
export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

/**
 * Decrypt one slice.
 *
 * Throws on a wrong key or tampered bytes — GCM authenticates, so a modified
 * ciphertext fails rather than decrypting to rubbish. The caller treats that as
 * "wrong passphrase", which is what it almost always is.
 */
export async function unseal(key: CryptoKey, sealed: Sealed): Promise<unknown> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext));
}

/**
 * A key for a guest-facing share, carried in the URL fragment.
 *
 * Not derived from the passphrase: guests do not have it, and must not be able
 * to reach the couple's own document with what they are given. A fresh random
 * key, printed into the link after the `#`, which browsers never send to a
 * server — so the host storing the ciphertext cannot read it either.
 */
export async function newShareKey(): Promise<{ key: CryptoKey; encoded: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await importShareKey(toBase64Url(raw));
  return { key, encoded: toBase64Url(raw) };
}

export async function importShareKey(encoded: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64Url(encoded), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// encoding --------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** URL-safe, and unpadded, so it survives a path segment and a fragment intact. */
function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

/**
 * Encrypt raw bytes — a font file, a monogram.
 *
 * Separate from `seal` because those go through JSON, and base64-ing a 300 KB
 * font through a JSON string to encrypt it would cost a third again in size for
 * nothing.
 */
export async function sealBytes(key: CryptoKey, bytes: Uint8Array): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    bytes as unknown as BufferSource,
  );
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function unsealBytes(key: CryptoKey, sealed: Sealed): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.ciphertext),
  );
  return new Uint8Array(plaintext);
}

/**
 * A cheap content fingerprint, for "has this slice changed since I last synced".
 *
 * FNV-1a over the serialised value. Not a security primitive and not trying to
 * be: it answers a local question about local data, and a collision costs one
 * unnecessary conflict prompt rather than any lost work.
 */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}:${text.length.toString(16)}`;
}
