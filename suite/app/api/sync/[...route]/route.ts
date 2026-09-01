import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  createWedding,
  deleteShare,
  deleteWedding,
  getBlob,
  getSalt,
  getShare,
  listBlobs,
  pull,
  push,
  putBlob,
  putShare,
  type Reply,
} from "@/lib/sync/handlers";
import {
  allow,
  authAttemptsRemain,
  callerKey,
  CREATE_LIMIT,
  noteAuthFailure,
  WRITE_LIMIT,
} from "@/lib/sync/rateLimit";
import {
  blobSchema,
  check,
  createSchema,
  params,
  pushSchema,
  shareSchema,
} from "@/lib/sync/schemas";
import { safely } from "@/lib/sync/safely";
import { memoryStore, type SyncStore } from "@/lib/sync/store";
import { supabaseStore } from "@/lib/sync/supabaseStore";

/**
 * The whole backend, in one route.
 *
 * Every path here moves ciphertext. Nothing on this server can read a guest
 * name, and the decisions it does make — who may write, and which of two
 * concurrent writes wins — live in `lib/sync/handlers`, tested against an
 * in-memory store.
 *
 * Sharing is entirely optional. With no Supabase configured the app is exactly
 * what it was: local-first, no account, nothing leaving the device.
 */

export const runtime = "nodejs";
// Never cached, never prerendered: every response is either a secret-checked
// read or a write.
export const dynamic = "force-dynamic";

function store(): SyncStore | null {
  const configured = supabaseStore();
  if (configured) return configured;
  if (env().SYNC_IN_MEMORY === "1") return devStore();
  return null;
}

let dev: SyncStore | null = null;
function devStore(): SyncStore {
  dev ??= memoryStore();
  return dev;
}

const send = (reply: Reply) => NextResponse.json(reply.body, { status: reply.status });

const unconfigured = () =>
  NextResponse.json(
    {
      error:
        "Sharing is not set up on this deployment. Everything still works on this device; " +
        "only publishing a link and syncing between machines need a backend.",
    },
    { status: 501 },
  );

/**
 * A 400 for anything that is not the right shape.
 *
 * Path segments are as attacker-controlled as bodies are — an id out of the URL
 * used to reach a primary key with neither length nor shape checked — so both
 * go through `lib/sync/schemas` before a handler sees them.
 */
const malformed = (error: string) => NextResponse.json({ error }, { status: 400 });

const throttled = () =>
  NextResponse.json(
    { error: "Too many requests. Wait a minute and try again." },
    { status: 429 },
  );


/** The passphrase-derived write token. Never the passphrase, never the content key. */
function tokenOf(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Run an authorised handler, counting failures against the caller.
 *
 * A 403 from any of these means a passphrase did not check out, and repeated
 * ones are somebody guessing. Counting only failures means an honest client
 * syncing all day is never throttled by its own success.
 */
async function guarded(request: Request, work: () => Promise<Reply>): Promise<NextResponse> {
  const caller = callerKey(request);
  if (!authAttemptsRemain(caller)) return throttled();
  if (!allow(`rw:${caller}`, WRITE_LIMIT)) return throttled();

  return safely(async () => {
    const reply = await work();
    if (reply.status === 403) noteAuthFailure(caller);
    return reply;
  });
}

export async function GET(request: Request, context: { params: Promise<{ route: string[] }> }) {
  const db = store();
  if (!db) return unconfigured();
  const { route } = await context.params;
  const [head, id, tail, extra] = route;

  if (head === "wedding" && id && tail === "salt") {
    // Counted before it is parsed, so a malformed id is not a free request.
    // Public, but still counted: the salt endpoint is the first step of a
    // guessing run, and it is the cheapest place to slow one down.
    if (!allow(`salt:${callerKey(request)}`, WRITE_LIMIT)) return throttled();
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    return safely(() => getSalt(db, weddingId.value));
  }
  if (head === "wedding" && id && tail === "slices") {
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    return guarded(request, () => pull(db, weddingId.value, tokenOf(request)));
  }
  if (head === "wedding" && id && tail === "blobs") {
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    return guarded(request, () => listBlobs(db, weddingId.value, tokenOf(request)));
  }
  if (head === "wedding" && id && tail === "blob" && extra) {
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    const asset = check(params.blobId, extra);
    if (!asset.ok) return malformed(asset.error);
    return guarded(request, () => getBlob(db, weddingId.value, tokenOf(request), asset.value));
  }
  if (head === "share" && id) {
    if (!allow(`share:${callerKey(request)}`, WRITE_LIMIT)) return throttled();
    const token = check(params.shareToken, id);
    if (!token.ok) return malformed(token.error);
    return safely(() => getShare(db, token.value));
  }

  return NextResponse.json({ error: "No such endpoint." }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ route: string[] }> }) {
  const db = store();
  if (!db) return unconfigured();
  const { route } = await context.params;
  const [head, id, tail, extra] = route;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That was not JSON." }, { status: 400 });
  }

  if (head === "wedding" && !id) {
    // The one unauthenticated write there is, so it gets the tightest limit.
    if (!allow(`create:${callerKey(request)}`, CREATE_LIMIT)) return throttled();
    const input = check(createSchema, body);
    if (!input.ok) return malformed(input.error);
    return safely(() => createWedding(db, input.value));
  }

  if (head === "wedding" && id && tail === "slices") {
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    const input = check(pushSchema, body);
    if (!input.ok) return malformed(input.error);
    return guarded(request, () => push(db, weddingId.value, tokenOf(request), input.value.writes));
  }

  if (head === "wedding" && id && tail === "blob" && extra) {
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    const asset = check(params.blobId, extra);
    if (!asset.ok) return malformed(asset.error);
    const input = check(blobSchema, body);
    if (!input.ok) return malformed(input.error);
    return guarded(request, () =>
      putBlob(db, weddingId.value, tokenOf(request), asset.value, input.value.sealed),
    );
  }

  if (head === "wedding" && id && tail === "share") {
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    const input = check(shareSchema, body);
    if (!input.ok) return malformed(input.error);
    return guarded(request, () => putShare(db, weddingId.value, tokenOf(request), input.value));
  }

  return NextResponse.json({ error: "No such endpoint." }, { status: 404 });
}

export async function DELETE(request: Request, context: { params: Promise<{ route: string[] }> }) {
  const db = store();
  if (!db) return unconfigured();
  const { route } = await context.params;
  const [head, id, tail, shareToken] = route;

  if (head === "wedding" && id && !tail) {
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    return guarded(request, () => deleteWedding(db, weddingId.value, tokenOf(request)));
  }

  if (head === "wedding" && id && tail === "share" && shareToken) {
    const weddingId = check(params.weddingId, id);
    if (!weddingId.ok) return malformed(weddingId.error);
    const token = check(params.shareToken, shareToken);
    if (!token.ok) return malformed(token.error);
    return guarded(request, () =>
      deleteShare(db, weddingId.value, tokenOf(request), token.value),
    );
  }

  return NextResponse.json({ error: "No such endpoint." }, { status: 404 });
}
