import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAPTERS, chapterForRoute } from "./steps";

const ROUTES = new Set(["/", "/seating", "/place-cards", "/timeline", "/delegation", "/group-shots"]);

describe("the chapters", () => {
  it("has one chapter per tool, plus the shell", () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual([
      "shell",
      "seating",
      "timeline",
      "place-cards",
      "delegation",
      "group-shots",
    ]);
  });

  it("gives every chapter between four and six steps", () => {
    for (const chapter of CHAPTERS) {
      expect(chapter.steps.length, chapter.id).toBeGreaterThanOrEqual(4);
      expect(chapter.steps.length, chapter.id).toBeLessThanOrEqual(6);
    }
  });

  it("gives every step words to say and a route that exists", () => {
    for (const chapter of CHAPTERS) {
      for (const step of chapter.steps) {
        expect(step.title.length, `${chapter.id}/${step.anchor}`).toBeGreaterThan(0);
        expect(step.body.length, `${chapter.id}/${step.anchor}`).toBeGreaterThan(20);
        expect(ROUTES.has(step.route), `${chapter.id}/${step.anchor} route`).toBe(true);
      }
    }
  });

  it("never repeats an anchor", () => {
    const all = CHAPTERS.flatMap((c) => c.steps.map((s) => s.anchor));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("chapterForRoute", () => {
  it("maps each tool route to its own chapter", () => {
    expect(chapterForRoute("/seating")).toBe("seating");
    expect(chapterForRoute("/group-shots")).toBe("group-shots");
  });

  it("falls back to the shell chapter for anything else", () => {
    expect(chapterForRoute("/")).toBe("shell");
    expect(chapterForRoute("/account")).toBe("shell");
  });
});

/**
 * The invariant that matters.
 *
 * A step whose anchor no longer exists degrades quietly at runtime — the card
 * shows, centred, pointing at nothing. That is right for a user and useless
 * for a maintainer, so renaming a control has to fail here instead. Follows
 * the grep-based pattern in apps/plaque/core/invariants.test.ts.
 */
describe("every anchor exists in the source", () => {
  const roots = ["app", "components", "apps", "lib"];
  const sources: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx|jsx)$/.test(entry)) sources.push(readFileSync(path, "utf8"));
    }
  };
  for (const root of roots) walk(root);
  const haystack = sources.join("\n");

  for (const chapter of CHAPTERS) {
    for (const step of chapter.steps) {
      it(`${chapter.id}: ${step.anchor}`, () => {
        expect(
          haystack.includes(`data-tour="${step.anchor}"`),
          `No element carries data-tour="${step.anchor}". Either add it, or fix the step.`,
        ).toBe(true);
      });
    }
  }
});

describe("the example wedding", () => {
  it("is a document the app can actually read", async () => {
    const { migrate } = await import("@jfrusher/trousseau");
    const raw = JSON.parse(
      readFileSync("fixtures/example-wedding.trousseau.json", "utf8"),
    ) as unknown;
    const doc = migrate(raw);
    expect(Object.keys(doc.guests).length).toBeGreaterThan(20);
    expect(doc.event.coupleNames.length).toBeGreaterThan(0);
  });

  it("is served to the browser as well as read by tests", () => {
    const served = readFileSync("public/fixtures/example-wedding.trousseau.json", "utf8");
    const source = readFileSync("fixtures/example-wedding.trousseau.json", "utf8");
    expect(served).toBe(source);
  });
});
