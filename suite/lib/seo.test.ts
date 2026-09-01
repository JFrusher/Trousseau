import { expect, test } from "vitest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";

/**
 * A guest link reaching a search index is the one genuinely damaging leak this
 * application has available to it. The fragment that decrypts a plan would
 * never reach a crawler, but the token and the names behind it would.
 */

const rule = () => {
  const [first] = robots().rules as Array<{ disallow?: string | string[] }>;
  const disallow = first?.disallow ?? [];
  return Array.isArray(disallow) ? disallow : [disallow];
};

test("crawlers are refused the guest pages and the API", () => {
  expect(rule()).toContain("/seat/");
  expect(rule()).toContain("/api/");
});

test("the sitemap offers nothing under /seat", () => {
  // Belt as well as braces: the page sets noindex itself, robots disallows it,
  // and it must not be advertised here either.
  for (const entry of sitemap()) {
    expect(entry.url).not.toContain("/seat");
  }
});

test("the sitemap lists the pages a stranger can actually read", () => {
  const paths = sitemap().map((entry) => new URL(entry.url).pathname);
  expect(paths).toContain("/privacy");
  expect(paths).toContain("/terms");
});

test("the sitemap does not advertise the tools", () => {
  // They are an application, not a document: a crawler reaching /seating finds
  // an empty editor, because the wedding it would edit is in someone's browser.
  const paths = sitemap().map((entry) => new URL(entry.url).pathname);
  for (const tool of ["/seating", "/timeline", "/place-cards", "/delegation"]) {
    expect(paths).not.toContain(tool);
  }
});

test("every sitemap URL is absolute", () => {
  // Relative entries are resolved by the crawler against whatever host it
  // fetched from, which is how a preview deployment ends up in an index.
  for (const entry of sitemap()) {
    expect(() => new URL(entry.url)).not.toThrow();
    expect(entry.url).toMatch(/^https?:\/\//);
  }
});

test("the sitemap points at its own origin's sitemap file", () => {
  const declared = robots().sitemap;
  const origin = new URL(sitemap()[0]!.url).origin;
  expect(declared).toBe(`${origin}/sitemap.xml`);
});
