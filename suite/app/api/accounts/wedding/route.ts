import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { createWeddingHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

const unauthenticated = () =>
  NextResponse.json({ error: "Sign in first." }, { status: 401 });

export async function POST() {
  if (!accountsConfigured()) return unconfigured();
  const user = await currentUser();
  if (!user) return unauthenticated();

  const client = await serverClient();
  if (!client) return unconfigured();

  const reply = await createWeddingHandler(accountsStore(client), user.id);
  return NextResponse.json(reply.body, { status: reply.status });
}
