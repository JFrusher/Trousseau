import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { acceptInviteHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";
import { check, tokenSchema } from "@/lib/accounts/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  if (!accountsConfigured()) {
    return NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { token: rawToken } = await context.params;
  const token = check(tokenSchema, rawToken);
  if (!token.ok) return NextResponse.json({ error: token.error }, { status: 400 });

  const client = await serverClient();
  if (!client) return NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

  const reply = await acceptInviteHandler(accountsStore(client), token.value, user.id);
  return NextResponse.json(reply.body, { status: reply.status });
}
