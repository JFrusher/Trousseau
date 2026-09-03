import type { NextConfig } from "next";
import { env } from "./lib/env";

// Checked here so a misconfigured deploy fails the build rather than answering
// 501 at runtime and looking like a deliberate local-only one. Called for the
// throw, not the value.
env();

const development = process.env.NODE_ENV === "development";

/**
 * Sentry's ingest origin, when there is one.
 *
 * `connect-src 'self'` would silently block every report — the browser refuses
 * the request and the SDK has nowhere to complain to, so error reporting would
 * appear to be configured and send nothing. Derived from the DSN rather than
 * written out, so the two cannot disagree.
 */
export function sentryOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

/**
 * Supabase's origin, when accounts are configured.
 *
 * Accounts (subsystem A) call Supabase directly from the browser —
 * `signInWithOtp`, `getUser`, `onAuthStateChange` all run client-side, unlike
 * the older E2E sync system in `lib/sync/`, which is reached only from route
 * handlers and needs nothing added here. Without this, `connect-src 'self'`
 * blocks every one of those calls silently: the browser refuses the request
 * before it leaves the page, and `fetch` reports it as a generic network
 * failure with nothing that names a CSP violation as the cause. Derived from
 * the same `NEXT_PUBLIC_SUPABASE_URL` the browser client itself reads, so
 * the two cannot disagree.
 */
export function supabaseOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Content Security Policy, without a nonce, and deliberately.
 *
 * The strict form — a per-request nonce from middleware plus `strict-dynamic` —
 * was built first and then abandoned, because it does not work here. Next 16
 * emits fourteen inline bootstrap scripts and stamps a nonce onto none of them,
 * whether the page is prerendered or forced dynamic. Both were tried against a
 * production server; both served a document whose every script the policy would
 * have blocked. A strict policy that blanks the application is worse than an
 * honest permissive one, so this is the permissive one.
 *
 * What is given up is real: with `'unsafe-inline'` on scripts, this policy
 * would not stop an injected `<script>`. What stops one here is that there is
 * nowhere to inject. React escapes what it renders, `parseSvgIcon` refuses an
 * uploaded SVG containing `<script>` by name rather than harvesting its paths,
 * and the single `dangerouslySetInnerHTML` renders a floor plan whose labels
 * the builder escapes.
 *
 * What is kept is the directive that matters most for this application:
 * `connect-src 'self'`, plus exactly the two named exceptions below. The
 * threat worth engineering against is not a defaced page, it is a guest list
 * leaving for somewhere else — and the browser is permitted to talk to this
 * origin, Sentry (when configured) and Supabase (when accounts are
 * configured), and nothing else. The older E2E sync system in `lib/sync/` is
 * reached only from route handlers and needs no exception of its own; the
 * accounts feature calls Supabase straight from the browser and does.
 *
 * Revisit if Next gains working nonce propagation, or if any page ever renders
 * HTML it did not construct itself.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  // `'unsafe-eval'` is React Refresh in development only, never shipped.
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  // Tailwind v4 emits an inline stylesheet, and every `style={{ … }}` prop in
  // the four tools is rendered into the HTML as a style attribute.
  "style-src 'self' 'unsafe-inline'",
  // `blob:` and `data:` are the PDF previews and the uploaded artwork, read
  // back out of IndexedDB as object URLs.
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  // The two named exceptions. Nothing the page holds can be sent anywhere but
  // here, Sentry (scrubbed as carefully as it is for exactly this reason),
  // and Supabase (which only ever sees an email address or a session token,
  // never a guest list).
  [
    "connect-src 'self'",
    sentryOrigin(env().NEXT_PUBLIC_SENTRY_DSN),
    supabaseOrigin(env().NEXT_PUBLIC_SUPABASE_URL),
  ]
    .filter(Boolean)
    .join(" "),
  // jsPDF and pdf-lib start workers from blob URLs.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Vercel sets this too. Stated anyway, so the guarantee follows the app
  // rather than the host it happens to be on.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // `frame-ancestors 'none'` above is the modern form and covers browsers that
  // read it; this is for the ones that do not.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // None of these are used, and a guest link is a public URL that should not be
  // able to ask for any of them.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
export { contentSecurityPolicy, securityHeaders };
