import { z } from "zod";
import { MAX_BLOB_BYTES, MAX_SLICE_BYTES, MAX_SLICES_PER_PUSH } from "./handlers";

/**
 * What the endpoints accept, checked before a handler sees it.
 *
 * The route used to cast — `body as { id: string; salt: string; authHash: string }`
 * — which is a promise to TypeScript and nothing at all at runtime. Three
 * things came through that gap, all reachable by anyone who can reach the URL:
 *
 * - A body of `null` or `[]`. Reading `.id` off it threw a TypeError, which
 *   surfaced as a 500 with a stack trace rather than a 400.
 * - `expectedVersion: "banana"`. Never checked anywhere, and handed to a
 *   Postgres function typed `integer`, which threw from inside the driver.
 * - Ids and tokens of unbounded length and arbitrary shape, straight into a
 *   primary key.
 *
 * The ceilings here are the same ones `handlers.ts` already enforces, applied a
 * step earlier so a malformed request is refused before it reaches a database.
 */

/** Base64, as WebCrypto's output is written by `crypto.ts`. */
const base64 = (max: number, what: string) =>
  z
    .string()
    .max(max, `That ${what} is over the limit.`)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, `That ${what} is not base64.`);

/** `newWeddingId()`: base64url of 16 random bytes. */
const weddingId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "That is not a wedding id.");

/** `crypto.randomUUID()` with the dashes taken out. */
const shareToken = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "That is not a share token.");

const SLASH = 0x2f;
const BACKSLASH = 0x5c;
const DELETE_KEY = 0x7f;

/**
 * An asset id, which the tools compose themselves.
 *
 * Plaque's include a filename — `img:my photo.png:12345` is a real one — so
 * this cannot be narrowed to hex, and spaces and dots have to survive. Written
 * as code-point comparisons rather than a character class because the two
 * characters worth refusing are the ones hardest to write legibly in a regex.
 *
 * Refuses control characters, and the separators that would let an id spill
 * into another route segment.
 */
function safeAssetId(id: string): boolean {
  for (const character of id) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === DELETE_KEY) return false;
    if (code === SLASH || code === BACKSLASH) return false;
  }
  return true;
}

const blobId = z
  .string()
  .min(1)
  .max(256)
  .refine(safeAssetId, "That is not an asset id.");

const sealed = (max: number, what: string) =>
  z.strictObject({
    ciphertext: base64(max, what),
    iv: base64(64, "nonce"),
  });

export const createSchema = z.strictObject({
  id: weddingId,
  salt: base64(128, "salt"),
  authHash: base64(128, "token hash"),
});

export const pushSchema = z.object({
  writes: z
    .array(
      z.strictObject({
        slice: z.string().min(1).max(64),
        sealed: sealed(MAX_SLICE_BYTES, "slice"),
        // The one that was never checked at all. A non-integer reached a
        // Postgres `integer` parameter and threw from inside the driver.
        expectedVersion: z.number().int().min(0),
      }),
    )
    .max(MAX_SLICES_PER_PUSH, "Too many slices in one push."),
});

export const blobSchema = z.object({ sealed: sealed(MAX_BLOB_BYTES, "file") });

export const shareSchema = z.strictObject({
  token: shareToken,
  sealed: sealed(MAX_SLICE_BYTES, "share"),
});

/** The parts of a request that arrive in the path rather than the body. */
export const params = { weddingId, shareToken, blobId };

interface Checked<T> {
  ok: true;
  value: T;
}
interface Failed {
  ok: false;
  error: string;
}

/**
 * Parse, or say what was wrong.
 *
 * Returns the first issue with its path, which is enough to fix a client and
 * says nothing about the wedding — these are shape complaints, not answers
 * about what exists.
 */
export function check<T>(schema: z.ZodType<T>, value: unknown): Checked<T> | Failed {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  const issue = result.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, error: `${where}${issue?.message ?? "Malformed request."}` };
}
