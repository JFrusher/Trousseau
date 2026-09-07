import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { documentStore } from "@/lib/documents/supabaseStore";
import { getDocumentHandler, saveDocumentHandler } from "@/lib/documents/handlers";
import { allow, WRITE_LIMIT } from "@/lib/sync/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

const unauthenticated = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });

const noWedding = () =>
  NextResponse.json({ error: "You don't have a wedding yet." }, { status: 404 });

const throttled = () =>
  NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });

const failed = (where: string, error: unknown) => {
  console.error(`[documents] ${where}`, error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
};

async function resolveWeddingId(client: NonNullable<Awaited<ReturnType<typeof serverClient>>>, userId: string) {
  const membership = await accountsStore(client).memberOf(userId);
  return membership?.weddingId ?? null;
}

export async function GET() {
  try {
    if (!accountsConfigured()) return unconfigured();
    const user = await currentUser();
    if (!user) return unauthenticated();

    const client = await serverClient();
    if (!client) return unconfigured();

    const weddingId = await resolveWeddingId(client, user.id);
    if (!weddingId) return noWedding();

    const reply = await getDocumentHandler(documentStore(client), weddingId);
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (error) {
    return failed("GET /api/documents", error);
  }
}

interface PutBody {
  document: unknown;
  expectedVersion: number;
}

export async function PUT(request: Request) {
  try {
    if (!accountsConfigured()) return unconfigured();
    const user = await currentUser();
    if (!user) return unauthenticated();

    // Keyed by account, not by IP: two couples on one office or mobile-carrier
    // NAT must not share a budget. The trade is that an *unauthenticated*
    // flood is not throttled here at all — those requests are refused by
    // `currentUser()` above before any document work happens, which is cheap
    // but not free. Accepted deliberately; revisit if it ever shows up in
    // real traffic.
    if (!allow(`documents:write:${user.id}`, WRITE_LIMIT)) return throttled();

    const client = await serverClient();
    if (!client) return unconfigured();

    const weddingId = await resolveWeddingId(client, user.id);
    if (!weddingId) return noWedding();

    let body: PutBody;
    try {
      body = (await request.json()) as PutBody;
    } catch {
      return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
    }
    if (typeof body.expectedVersion !== "number" || body.document === undefined) {
      return NextResponse.json({ error: "A document and its expected version are required." }, { status: 400 });
    }

    const reply = await saveDocumentHandler(documentStore(client), weddingId, body.document, body.expectedVersion);
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (error) {
    return failed("PUT /api/documents", error);
  }
}
