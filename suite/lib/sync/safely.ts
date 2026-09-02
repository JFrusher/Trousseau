import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import type { Reply } from "./handlers";

/**
 * The database and this code disagree about what columns exist.
 *
 * Two quite different wordings, because there are two layers. Postgres itself
 * says `column "x" of relation "y" does not exist`, which means the migrations
 * have not been applied. PostgREST — which is what Supabase actually puts in
 * front of the database — says `Could not find the 'x' column of 'y' in the
 * schema cache`, which usually means they *have* been applied and PostgREST is
 * still holding the schema it read before.
 *
 * The second is the one that catches people out, because every check they can
 * run against the database says the column is there.
 */
export function schemaIsBehind(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return (
    /(column|relation) .* does not exist/i.test(message) ||
    /could not find .* in the schema cache/i.test(message)
  );
}

/**
 * The backend could not be reached at all.
 *
 * A paused Supabase project — which is what a free one does after a week of
 * quiet — does not refuse the connection, it stops answering, so this arrives
 * as a timeout or a bare `fetch failed` rather than anything about SQL.
 */
export function backendUnreachable(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /fetch failed|timed out|timeout|aborted|ENOTFOUND|ECONNREFUSED|network/i.test(message);
}

/** Whether it is PostgREST's cache rather than the database that is stale. */
export function schemaCacheIsStale(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /could not find .* in the schema cache/i.test(message);
}

/**
 * Every layer of `.cause`, since Node nests the real reason under one.
 *
 * supabase-js catches a fetch failure and re-throws it as a plain `Error`,
 * dropping undici's `.cause` chain — which is where the actual reason lives:
 * `ECONNREFUSED`, `ENETUNREACH`, a certificate failure, the abort from a
 * timeout. By the time that re-thrown error reaches `safely()` the detail is
 * already gone, so the fetch wrapper in `supabaseStore.ts` calls this on the
 * original error, before supabase-js gets to it.
 */
export function describeCause(error: unknown): string {
  const seen: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) {
      seen.push(`${current.name}: ${current.message}`);
      current = current.cause;
    } else {
      seen.push(String(current));
      break;
    }
  }
  return seen.join(" <- caused by <- ");
}

function hostOf(url: string | undefined): string {
  if (!url) return "no SUPABASE_URL set";
  try {
    return new URL(url).host;
  } catch {
    return `an unparseable SUPABASE_URL (${url.slice(0, 40)})`;
  }
}

export type Failure = "unreachable" | "schema-cache" | "schema-behind" | "unknown";

export function categorise(cause: unknown): Failure {
  if (backendUnreachable(cause)) return "unreachable";
  if (schemaCacheIsStale(cause)) return "schema-cache";
  if (schemaIsBehind(cause)) return "schema-behind";
  return "unknown";
}

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
export async function safely(work: () => Promise<Reply>): Promise<NextResponse> {
  try {
    const reply = await work();
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (cause) {
    // The one failure worth naming, because it has a specific fix and is
    // otherwise a mystery: the code is deployed ahead of its migrations, so
    // every write fails on a column that does not exist yet.
    if (backendUnreachable(cause)) {
      // The host, so a typo is visible here rather than requiring a trip to the
      // dashboard to compare two strings by eye. The URL is not a secret — the
      // service role key is, and that is never printed.
      console.error(
        `[Trousseau] could not reach Supabase at ${hostOf(env().SUPABASE_URL)}. ` +
          "`fetch failed` this early is usually DNS: check that host actually " +
          "exists and matches the project you applied the migrations to. If it " +
          "is right, a free project pauses after a week idle — restore it from " +
          "the dashboard.",
      );
    } else if (schemaCacheIsStale(cause)) {
      console.error(
        "[Trousseau] PostgREST is serving a stale schema. The migrations are " +
          "probably applied and its cache has not caught up — run " +
          "NOTIFY pgrst, 'reload schema'; in the SQL editor, or restart the " +
          "Supabase project. Every write fails until it reloads.",
      );
    } else if (schemaIsBehind(cause)) {
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
        // Which of the three it was, as a fixed word rather than the database's
        // own message. Whoever is trying to fix this should not have to go and
        // find a log to learn which branch fired, and a category from a closed
        // set leaks nothing — unlike an error that names columns and
        // constraints.
        cause: categorise(cause),
      },
      { status: 503 },
    );
  }
}
