import { NextResponse } from "next/server";
import type { Reply } from "./handlers";

/**
 * Run a handler, and turn a failing store into an answer rather than a stack.
 *
 * Every sync endpoint reaches a database, and nothing caught what that database
 * might throw: a Postgres error propagated out of the route as an unhandled
 * exception and reached the client as a bare 500 with no message. That is the
 * worst possible answer for the person on the other end, who is told only that
 * something went wrong while their wedding was being saved.
 *
 * It is not hypothetical. Deploying against a database whose migrations have
 * not been applied makes every write fail this way — the columns the store
 * writes do not exist yet — and the first thing anyone does with a passphrase
 * is a write.
 *
 * The client gets 503 and a sentence it can act on. The detail goes to the
 * server log and to Sentry, because it is for whoever runs this, and a database
 * error can name columns and constraints that a public endpoint should not.
 */
/** Postgres' wording when a migration has not been applied. */
export function schemaIsBehind(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /(column|relation) .* does not exist/i.test(message);
}

export async function safely(work: () => Promise<Reply>): Promise<NextResponse> {
  try {
    const reply = await work();
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (cause) {
    // The one failure worth naming, because it has a specific fix and is
    // otherwise a mystery: the code is deployed ahead of its migrations, so
    // every write fails on a column that does not exist yet.
    if (schemaIsBehind(cause)) {
      console.error(
        "[Trousseau] the database is missing a column this code writes. " +
          "Apply supabase/migrations before deploying — every write fails until you do.",
      );
    }
    console.error("[Trousseau] sync backend failed:", cause);
    return NextResponse.json(
      {
        error:
          "Sharing is temporarily unavailable. Your wedding is safe on this device — " +
          "nothing was lost, and nothing was half-written.",
      },
      { status: 503 },
    );
  }
}
