import Link from "next/link";

export const metadata = {
  title: "Not found · Trousseau",
  robots: { index: false, follow: false },
};

/**
 * Two quite different people reach this page.
 *
 * One mistyped a path in their own planning app, and wants the way back. The
 * other followed a guest link that has been taken down or republished, and does
 * not know what Trousseau is — so this must not read as an application error
 * they caused, and must not offer them the planning tools.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6 py-16 text-center">
      <p className="text-sm tracking-[0.14em] text-slate uppercase">Not found</p>
      <h1 className="mt-4 text-3xl">There is nothing at this address</h1>
      <p className="mt-4 text-slate">
        If you were sent a link to find your seat, ask whoever sent it for the current one — a
        link that has been replaced or taken down stops working straight away.
      </p>
      <p className="mt-8">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded border border-charcoal px-5 py-2.5 hover:bg-stone"
        >
          Go to the wedding
        </Link>
      </p>
    </main>
  );
}
