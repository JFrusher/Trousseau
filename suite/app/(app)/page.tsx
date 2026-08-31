import Link from "next/link";
import { HardDrive, GitBranch, KeyRound } from "lucide-react";
import { QuickStats } from "@/components/shell/QuickStats";

const PROMISES = [
  {
    icon: HardDrive,
    title: "Nothing is uploaded",
    body: "Guest names, dietary requirements, phone numbers and addresses stay in this browser. There is no server holding them, because there is no server.",
  },
  {
    icon: KeyRound,
    title: "Nothing to sign up for",
    body: "No account, no email, no trial. Open the page and start. Your work is here when you come back, and one button writes it to a file you keep.",
  },
  {
    icon: GitBranch,
    title: "Nothing is hidden",
    body: "MIT licensed and open source. Built for one real wedding, which is the only reason the awkward parts work.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-20">
      <section className="max-w-2xl">
        <p className="mb-4 text-xs tracking-[0.2em] text-gold uppercase">
          Seating · Stationery · Timeline · Crew
        </p>
        <h1 className="font-display text-4xl leading-tight text-charcoal sm:text-5xl">
          One wedding, four tools, and no arguments about which copy is right.
        </h1>
        <p className="mt-5 text-lg text-slate">
          Seat the room and the place cards already know the table numbers. Move a block of the
          day and every job hanging off it moves too. One guest list, held once, read by
          everything.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/seating"
            className="rounded border border-gold bg-gold/15 px-4 py-2 text-charcoal transition hover:bg-gold/25"
          >
            Start with the room
          </Link>
          <Link
            href="/timeline"
            className="rounded border border-charcoal/15 px-4 py-2 text-slate transition hover:border-charcoal/30 hover:text-charcoal"
          >
            Or with the day
          </Link>
        </div>
      </section>

      <section className="mt-14">
        <QuickStats />
      </section>

      <section className="mt-14 grid gap-8 sm:grid-cols-3">
        {PROMISES.map(({ icon: Icon, title, body }) => (
          <div key={title}>
            <Icon size={20} className="mb-3 text-sage" />
            <h3 className="mb-2 text-base">{title}</h3>
            <p className="text-sm text-slate">{body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-16 border-t border-charcoal/10 pt-6 text-xs text-slate">
        Built on the Trousseau data contract — one document, one owner per slice, and every key
        it does not understand copied through untouched.
      </footer>
    </div>
  );
}
