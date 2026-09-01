import type { Metadata } from "next";
import { Lato, Marcellus } from "next/font/google";
import { ReportUnhandled } from "@/components/shell/ReportUnhandled";
import { siteUrl } from "@/lib/env";
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

const description =
  "Seating, stationery, timeline and crew for one wedding. Free, open source, and entirely on your own device.";

export const metadata: Metadata = {
  // Absolute URLs for canonical links and OpenGraph tags are built from this.
  // Without it Next emits relative ones, which crawlers and link previews
  // resolve against whatever host they happened to fetch from.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Trousseau",
    // Pages set their own; this keeps the suffix in one place for the rest.
    template: "%s · Trousseau",
  },
  description,
  applicationName: "Trousseau",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Trousseau",
    title: "Trousseau",
    description,
    locale: "en_GB",
  },
  twitter: { card: "summary_large_image", title: "Trousseau", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${marcellus.variable} ${lato.variable}`}>
      {/* Nothing but the page here. The header and the local document belong to
          the (app) group; /seat deliberately gets neither. */}
      <body>
        <ReportUnhandled />
        {children}
      </body>
    </html>
  );
}
