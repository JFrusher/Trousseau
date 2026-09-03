import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { env, accountsConfigured } from "@/lib/env";
import { deleteAccountHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!accountsConfigured()) {
    return NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const client = await serverClient();
  if (!client) {
    return NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });
  }

  // Membership/wedding cleanup first, as the user's own session — then the
  // actual auth.users row, which needs the service-role key (deleting a user
  // is an admin operation; no RLS policy could ever grant it to a user acting
  // on themselves). If this second step fails, the account keeps existing
  // with no wedding attached — a degraded state, not data loss.
  const reply = await deleteAccountHandler(accountsStore(client), user.id);
  if (reply.status !== 200) return NextResponse.json(reply.body, { status: reply.status });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Your wedding data was removed, but the account itself could not be deleted on this deployment." },
      { status: 500 },
    );
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json(
      { error: `Your wedding data was removed, but the account itself could not be deleted: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({}, { status: 200 });
}
