import type { Metadata } from "next";
import { QuickStats } from "@/components/shell/QuickStats";
import { WhatIsLeft } from "@/components/shell/WhatIsLeft";
import { Countdown } from "@/components/shell/Countdown";
import { WeddingPack } from "@/components/shell/WeddingPack";

export const metadata: Metadata = {
  title: "Trousseau",
  description: "Seating, stationery, timeline and crew for one wedding.",
};

/**
 * The wedding at a glance.
 *
 * This page used to sell the app: a headline, three columns about local-first
 * storage, a licence. That was written for someone deciding whether to use it.
 * There is one person using it, they decided, and they now open this page to
 * find out where things stand — so it answers that instead.
 *
 * What was true in the pitch has not been deleted so much as demoted: the
 * promises about nothing being uploaded are kept where they are actually load
 * bearing, in the Data panel, next to the buttons they describe.
 */
export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <Countdown />

      <section className="mt-10">
        <QuickStats />
      </section>

      <section className="mt-12">
        <h2 className="mb-4 text-sm tracking-[0.14em] text-slate uppercase">What is left</h2>
        <WhatIsLeft />
      </section>

      <section className="mt-12">
        <WeddingPack />
      </section>
    </div>
  );
}
