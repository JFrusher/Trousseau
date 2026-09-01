import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sweepAbandoned } from "@/lib/sync/handlers";
import { supabaseStore } from "@/lib/sync/supabaseStore";

/**
 * Retention, once a day.
 *
 * The only endpoint here that deletes without a passphrase, which is the point:
 * it exists for weddings whose passphrase is gone, and which therefore nobody
 * can ask to have removed. Everything about it is written to fail closed.
 *
 * No `CRON_SECRET` means every request is refused, including Vercel's. An
 * endpoint that deletes and has no credential configured must do nothing rather
 * than trust its caller.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { CRON_SECRET } = env();
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "No sweep is configured." }, { status: 501 });
  }

  const presented = request.headers.get("authorization");
  if (presented !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "No." }, { status: 401 });
  }

  const db = supabaseStore();
  if (!db) return NextResponse.json({ error: "No backend." }, { status: 501 });

  try {
    const { deleted } = await sweepAbandoned(db);
    // Ids only. They identify a row, not a person, and the server could not say
    // whose wedding it was even if it wanted to.
    console.info(`[Trousseau] retention sweep removed ${deleted.length} wedding(s)`);
    return NextResponse.json({ deleted: deleted.length });
  } catch (cause) {
    // A failed sweep must be loud: it deletes, it runs unattended, and silence
    // here means data kept past the period the Privacy Policy states.
    console.error("[Trousseau] retention sweep failed:", cause);
    return NextResponse.json({ error: "The sweep failed." }, { status: 503 });
  }
}
