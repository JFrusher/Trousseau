import { z } from "zod";

/**
 * The environment, checked once, at build.
 *
 * Two things made this worth having. The app is meant to run with no backend at
 * all — that is not a degraded mode, it is the default, and the schema has to
 * keep saying so. But *half* a backend was indistinguishable from none: a URL
 * with no service key fell through the same `if (!url || !key) return null` and
 * the endpoints answered 501, so a typo in one Vercel variable looked exactly
 * like a deliberate local-only deploy. The failure was silent, and it was
 * silent on the one path where data leaves the device.
 *
 * So: all of it, or none of it, and never half.
 */

/**
 * An unset variable and an empty one are the same thing here.
 *
 * `.env` files and dashboard fields both yield `""` for a variable someone
 * cleared, and `z.url()` rejects that with "invalid URL" — which reads as a
 * malformed address rather than an absent one, and sends you looking for a typo
 * in a value that is not there.
 */
const absent = <T extends z.ZodType>(inner: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), inner.optional());

const schema = z
  .object({
    SUPABASE_URL: absent(z.url()),
    SUPABASE_SERVICE_ROLE_KEY: absent(z.string().min(1)),

    /**
     * Development only: run the sync endpoints against a process-local map.
     * Enforced below, because the cost of getting this wrong is a wedding
     * accepted into memory that disappears on the next deploy — reported to the
     * user as a successful save.
     */
    SYNC_IN_MEMORY: absent(z.enum(["0", "1"])),

    /** Public by design — a DSN identifies a project, it does not authorise. */
    NEXT_PUBLIC_SENTRY_DSN: absent(z.url()),

    /**
     * Shared secret for the retention sweep, which Vercel Cron presents as a
     * bearer token. Unset means the endpoint refuses everything — the safe
     * direction for a route whose whole job is deleting.
     */
    CRON_SECRET: absent(z.string().min(16)),

    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .superRefine((env, ctx) => {
    const url = Boolean(env.SUPABASE_URL);
    const key = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
    if (url !== key) {
      ctx.addIssue({
        code: "custom",
        path: [url ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_URL"],
        message:
          "Supabase is half-configured. Set both SUPABASE_URL and " +
          "SUPABASE_SERVICE_ROLE_KEY, or neither — with neither, the app runs " +
          "local-only, which is a supported deployment.",
      });
    }

    if (env.NODE_ENV === "production" && env.SYNC_IN_MEMORY === "1") {
      ctx.addIssue({
        code: "custom",
        path: ["SYNC_IN_MEMORY"],
        message:
          "SYNC_IN_MEMORY is a development shim and must never be set in " +
          "production: it accepts a wedding into a map that vanishes on the " +
          "next deploy, and tells the user it was saved.",
      });
    }
  });

export type Env = z.infer<typeof schema>;

/** Exported for the tests, which need to try environments this process is not in. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Environment is not usable:\n${lines.join("\n")}`);
}

let cached: Env | undefined;

/**
 * The validated environment.
 *
 * Memoised rather than evaluated at module load: importing this file must not
 * be what decides whether the build fails. `next.config.ts` calls it
 * deliberately, so the error arrives at build time with everything else the
 * config knows, rather than from whichever route happened to be compiled first.
 */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Whether this deployment has somewhere to put ciphertext. */
export function syncConfigured(): boolean {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}
