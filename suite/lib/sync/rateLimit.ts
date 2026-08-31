/**
 * A fixed-window rate limiter, in memory.
 *
 * This is a public URL that anyone who finds the domain can reach. Without a
 * limit, two things are free to a stranger: creating unlimited weddings, and
 * guessing a passphrase against the slice endpoints as fast as the network
 * allows. PBKDF2 makes each guess expensive for an honest client, but an
 * attacker writing their own client only pays it once per candidate — and the
 * server was paying nothing at all.
 *
 * ponytail: in memory, so the window is per serverless instance rather than
 * global, and a determined attacker gets one window per instance Vercel happens
 * to spin up. That is a genuine ceiling, not a pretence: it turns an
 * unthrottled attack into a slow one. If this ever needs to be exact, move the
 * counter into Postgres — the table and the transaction are the easy part.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Stop the map growing without bound on a long-lived instance. */
function sweep(now: number): void {
  if (windows.size < 5000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface Limit {
  /** How many requests are allowed in the window. */
  max: number;
  windowMs: number;
}

/** Creating weddings: rare, and the most expensive thing a stranger can do. */
export const CREATE_LIMIT: Limit = { max: 5, windowMs: 60 * 60 * 1000 };

/** Failed unlock attempts. Generous enough never to bite a real typo. */
export const AUTH_LIMIT: Limit = { max: 20, windowMs: 15 * 60 * 1000 };

/** Ordinary reads and writes by somebody already holding the passphrase. */
export const WRITE_LIMIT: Limit = { max: 600, windowMs: 60 * 1000 };

export function allow(key: string, limit: Limit): boolean {
  const now = Date.now();
  sweep(now);

  const found = windows.get(key);
  if (!found || found.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + limit.windowMs });
    return true;
  }

  if (found.count >= limit.max) return false;
  found.count += 1;
  return true;
}

/**
 * Who is asking.
 *
 * Vercel sets `x-forwarded-for`, and the left-most entry is the client as its
 * edge saw it. Falls back to a single bucket rather than to something
 * spoofable: when the header is missing, everyone shares one window, which is
 * the safe direction to be wrong in.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

/** Only failures count, so a working session is never throttled by its own use. */
export function noteAuthFailure(key: string): void {
  allow(`auth:${key}`, AUTH_LIMIT);
}

export function authAttemptsRemain(key: string): boolean {
  const found = windows.get(`auth:${key}`);
  if (!found || found.resetAt <= Date.now()) return true;
  return found.count < AUTH_LIMIT.max;
}
