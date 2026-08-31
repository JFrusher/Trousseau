"use client";

import dynamic from "next/dynamic";

import { WhenDocumentReady } from "@/components/shell/WhenDocumentReady";
import "@/apps/brigade/index.css";

/**
 * Brigade, rendered only in the browser.
 *
 * Like the other tools it was a single-page app, and it still behaves like one:
 * it reads the crew and the day out of the shared document before it can draw
 * anything, which a server cannot do.
 */
const App = dynamic(() => import("@/apps/brigade/App").then((m) => m.App), { ssr: false });

/**
 * The class carries Brigade's design tokens, which used to sit on `:root`. It is
 * here rather than inside the tool so that nothing in `apps/brigade` had to know
 * it stopped being the only app on the page.
 */
export function BrigadeApp() {
  return (
    <div className="brigade-scope">
      <WhenDocumentReady>
        <App />
      </WhenDocumentReady>
    </div>
  );
}
