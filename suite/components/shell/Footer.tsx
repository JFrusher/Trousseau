import Link from "next/link";
import { PRIVACY } from "@/lib/legal";

/**
 * The footer, on every page of the application and on the guest page.
 *
 * Quiet on purpose — these are tools people work in for hours, and a footer
 * competing with the canvas would be worse than none. But the links have to be
 * reachable from somewhere on every page, and a guest looking at their own name
 * is exactly the person entitled to find the privacy policy.
 */
export function Footer() {
  return (
    <footer className="mt-16 border-t border-stone px-4 py-6 text-xs text-slate print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
        <span>Trousseau — your wedding, on your own device.</span>
        {/* `min-h-11` is 44px: these are the only controls on the guest page
            besides the search box, and a guest is on a phone at a venue. */}
        <nav className="flex gap-2">
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center px-2 underline underline-offset-2 hover:text-charcoal"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="inline-flex min-h-11 items-center px-2 underline underline-offset-2 hover:text-charcoal"
          >
            Terms
          </Link>
        </nav>
        <span className="ms-auto">
          Updated{" "}
          <time dateTime={PRIVACY.updated}>
            {new Date(PRIVACY.updated).toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            })}
          </time>
        </span>
      </div>
    </footer>
  );
}
