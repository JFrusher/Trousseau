import type { Metadata } from "next";
import { Lato, Marcellus } from "next/font/google";
import "./globals.css";
// Before any tool's own stylesheet: each of those maps its vocabulary onto the
// values decided here, so these have to exist by the time they are read.
import "@/lib/design/tokens.css";

// Self-hosted at build time — no runtime request leaves the browser, which is
// the whole premise of these tools.
const marcellus = Marcellus({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-marcellus",
});
const lato = Lato({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-lato",
});

export const metadata: Metadata = {
  title: "Trousseau",
  description:
    "Seating, stationery, timeline and crew for one wedding. Free, open source, and entirely on your own device.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${marcellus.variable} ${lato.variable}`}>
      {/* Nothing but the page here. The header and the local document belong to
          the (app) group; /seat deliberately gets neither. */}
      <body>{children}</body>
    </html>
  );
}
