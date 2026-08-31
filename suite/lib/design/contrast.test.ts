import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every text colour the suite puts on screen, against the ground it sits on,
 * must clear WCAG AA.
 *
 * This began as Cadence's test of Cadence's tokens. The tokens are shared now,
 * so the test is too — which matters more than it sounds: the accents are the
 * one thing still chosen per tool, and they are exactly where a colour picked
 * because it looked handsome turns out to be unreadable. Sage and bronze both
 * failed as text at full strength, which is why each tool carries a readable
 * `--accent` and a separate `--accent-bright` for the places colour is only
 * ever a block rather than something anyone has to read.
 */

const SOURCE = "lib/design/tokens.css";

/**
 * Parses the token file one selector block at a time.
 *
 * Block-aware on purpose: `--accent` is declared four times, once per tool, and
 * a flat scan would keep whichever came last and then cheerfully report that
 * every tool passes because one of them does.
 */
function blocks(): Record<string, Record<string, string>> {
  const css = readFileSync(SOURCE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, Record<string, string>> = {};

  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const declarations: Record<string, string> = {};
    for (const line of (match[2] ?? "").matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) {
      declarations[line[1] as string] = (line[2] as string).trim();
    }
    // One rule can carry several selectors — the three sibling tools share a block.
    for (const selector of (match[1] ?? "").split(",")) {
      const key = selector.trim();
      if (!key) continue;
      out[key] = { ...out[key], ...declarations };
    }
  }
  return out;
}

const parsed = blocks();
const root = parsed[":root"] ?? {};

/** Resolves a token to a literal, following one `var(--t-x)` hop into `:root`. */
function hex(scope: string, token: string): string {
  const raw = parsed[scope]?.[token] ?? root[token];
  expect(raw, `${token} is not defined for ${scope}`).toBeTypeOf("string");
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(raw as string);
  const value = reference ? root[reference[1] as string] : raw;
  expect(value, `${token} does not resolve to a colour for ${scope}`).toMatch(/^#[0-9a-f]{6}$/i);
  return value as string;
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(value: string): number {
  const rgb = parseInt(value.slice(1), 16);
  return (
    0.2126 * channel((rgb >> 16) & 255) +
    0.7152 * channel((rgb >> 8) & 255) +
    0.0722 * channel(rgb & 255)
  );
}

export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SCOPES = [".plaque-scope", ".cadence-scope", ".brigade-scope", ".tableaux-scope"];

/** The tint each tool fills behind its own accent text. Tableaux named it differently. */
const TINT: Record<string, string> = {
  ".plaque-scope": "--accent-soft",
  ".cadence-scope": "--accent-soft",
  ".brigade-scope": "--accent-soft",
  ".tableaux-scope": "--accent-light",
};

describe("the shared ramp", () => {
  it("reads as a token file", () => {
    expect(Object.keys(root).length).toBeGreaterThan(20);
  });

  const GROUNDS = ["--t-0", "--t-1", "--t-2"];
  const TEXT = ["--t-9", "--t-7", "--t-6"];

  for (const ink of TEXT) {
    for (const ground of GROUNDS) {
      it(`${ink} on ${ground} clears AA`, () => {
        expect(contrast(hex(":root", ink), hex(":root", ground))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const [ink, ground] of [
    ["--t-danger", "--t-danger-soft"],
    ["--t-warn", "--t-warn-soft"],
    ["--t-ok", "--t-ok-soft"],
    ["--t-danger", "--t-1"],
    ["--t-warn", "--t-1"],
    ["--t-ok", "--t-1"],
  ] as const) {
    it(`${ink} on ${ground} clears AA`, () => {
      expect(contrast(hex(":root", ink), hex(":root", ground))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("each tool's accent", () => {
  for (const scope of SCOPES) {
    it(`${scope} accent is readable on the ground`, () => {
      expect(contrast(hex(scope, "--accent"), hex(":root", "--t-1"))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${scope} accent is readable on its own tint`, () => {
      expect(contrast(hex(scope, "--accent"), hex(scope, TINT[scope] as string))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${scope} accent carries white text`, () => {
      expect(contrast(hex(":root", "--t-0"), hex(scope, "--accent"))).toBeGreaterThanOrEqual(4.5);
    });

    /**
     * The identity colour is never read, only seen — a tab indicator, a chip.
     * So it answers to the 3:1 the guidelines set for a control you have to be
     * able to make out, not the 4.5:1 they set for words.
     */
    it(`${scope} identity colour is distinguishable`, () => {
      expect(contrast(hex(scope, "--accent-bright"), hex(":root", "--t-1"))).toBeGreaterThanOrEqual(3);
    });
  }
});
