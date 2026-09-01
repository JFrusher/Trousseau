import Link from "next/link";
import type { Policy } from "@/lib/legal";

/**
 * How both policies are rendered.
 *
 * Outside the `(app)` route group on purpose. A guest who followed a link to
 * find their table is one of the people these pages are written for, and the
 * app's header would offer them a Seating tab that opens whatever wedding
 * happens to be in *their* browser.
 */
export function PolicyPage({ policy }: { policy: Policy }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <p className="text-sm tracking-[0.14em] text-slate uppercase">Trousseau</p>
      <h1 className="mt-3 text-3xl">{policy.title}</h1>
      <p className="mt-2 text-sm text-slate">
        Last updated{" "}
        <time dateTime={policy.updated}>
          {new Date(policy.updated).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </time>
      </p>

      <p className="mt-6 text-slate">{policy.intro}</p>

      {policy.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-xl">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="mt-3 text-slate">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <p className="mt-12 border-t border-stone pt-6 text-sm">
        <Link href="/" className="underline underline-offset-2 hover:text-charcoal">
          Back to Trousseau
        </Link>
      </p>
    </main>
  );
}
