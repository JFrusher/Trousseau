import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The tools do not touch the network. Only the sync layer may.
 *
 * Each of the four apps promised, on its own, that a guest list never leaves
 * the device — and each enforced it by scanning its built bundle for anything
 * that could reach another origin. Bringing them under one roof with an
 * optional backend makes that promise more delicate, not less: there is now
 * network code in the building, and the thing that must not happen is a tool
 * quietly acquiring a `fetch`.
 *
 * So the rule is drawn where it now belongs. Everything under `apps/` is a
 * tool, and a tool that can make a request is a tool that can leak a guest
 * list. The one place allowed to talk is `lib/sync`, which encrypts before it
 * does — and which has its own tests proving the server never sees plaintext.
 *
 * A grep-shaped test, deliberately. The alternative is a lint rule nobody
 * installs, and what is being protected is the shape of the code rather than
 * any value a unit test could observe.
 */

const NETWORK_APIS = [
  "fetch(",
  "XMLHttpRequest",
  "navigator.sendBeacon",
  "new WebSocket",
  "new EventSource",
];

/**
 * The one tool file allowed to fetch, named rather than pattern-matched.
 *
 * It reads the bundled fonts off this app's own origin, which is the only way
 * to get bytes to fontkit. A pattern was the first attempt and was worse than
 * useless: it looked for a `/fonts/` literal inside the call, so it passed the
 * file only by accident of how the URL happened to be spelled, and would have
 * gone on passing it once that argument became a variable holding anything.
 *
 * What actually holds the promise is the host check below, which nothing is
 * exempt from — a same-origin request cannot reach a third party, so a fetch
 * here can only ask this app's own server for a file it already shipped.
 */
const MAY_FETCH = [
  join("apps", "plaque", "state", "fontLoader.ts"),
  join("apps", "cadence", "render", "pdf", "fontSource.ts"),
  join("apps", "brigade", "render", "pdf", "fontSource.ts"),
];

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return filesIn(path);
    // `.js`/`.jsx` as well as TypeScript: Tableaux is written in JSX, and it is
    // the tool that most needs checking — it arrived with an HTTP client, a
    // Supabase session and a public share API, all of which were taken out by
    // hand. A scan that skipped its file extensions would have proved nothing
    // about the one app where the promise was hardest to keep.
    return /\.(ts|tsx|js|jsx)$/.test(path) && !path.includes(".test.") ? [path] : [];
  });
}

/** Comments do not execute, and several of them discuss the forbidden APIs. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the tools reach no further than this device", () => {
  const sources = filesIn("apps");

  it("finds the tools to check", () => {
    // A rename that emptied this list would make every assertion below vacuous.
    expect(sources.length).toBeGreaterThan(250);
  });

  it.each(NETWORK_APIS)("no tool calls %s", (api) => {
    const offenders = sources.filter((path) => {
      const body = code(readFileSync(path, "utf8"));
      if (!body.includes(api)) return false;
      return !(api === "fetch(" && MAY_FETCH.includes(path));
    });

    expect(offenders, `${api} in a tool would let a guest list leave the device`).toEqual([]);
  });

  it("no tool names an outside host", () => {
    const offenders = sources.filter((path) => {
      const body = code(readFileSync(path, "utf8"));
      for (const match of body.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = match[1] ?? "";
        // XML namespaces, PDF metadata schemas and the documentation links
        // libraries print inside error messages. None is ever requested.
        if (/^(www\.w3\.org|ns\.adobe\.com|www\.aiim\.org|purl\.org|iptc\.org|react\.dev|reactjs\.org|github\.com|nextjs\.org)$/.test(host)) {
          continue;
        }
        return true;
      }
      return false;
    });

    expect(offenders).toEqual([]);
  });
});
