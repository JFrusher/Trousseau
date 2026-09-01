import { expect, test } from "vitest";
import { scrubEvent, stripFragment } from "./scrub";

/**
 * The test that protects the encryption model.
 *
 * A guest link is `/seat/{token}#k={key}`. If that fragment ever reaches an
 * error reporter, the reporter can decrypt the wedding — and `location.href`,
 * which is what reporters attach to every event, contains it.
 */

const KEY = "s3cret-decryption-key";
const LINK = `https://trousseau.example/seat/abc123#k=${KEY}`;

test("a fragment never survives, and the rest of the URL does", () => {
  const scrubbed = stripFragment(LINK);
  expect(scrubbed).not.toContain(KEY);
  // The path is kept: the token alone is useless without the key, and it is
  // what makes a report worth reading.
  expect(scrubbed).toContain("/seat/abc123");
});

test("a URL with no fragment is left alone", () => {
  expect(stripFragment("https://trousseau.example/seating")).toBe(
    "https://trousseau.example/seating",
  );
});

test("the request URL is scrubbed", () => {
  const event = scrubEvent({ request: { url: LINK } });
  expect(JSON.stringify(event)).not.toContain(KEY);
});

test("navigation breadcrumbs are scrubbed, in both directions", () => {
  // A guest arriving on a link is precisely a navigation, so this is the most
  // likely place for the key to appear.
  const event = scrubEvent({
    breadcrumbs: [{ data: { from: LINK, to: LINK } }, { data: { href: LINK } }],
  });
  expect(JSON.stringify(event)).not.toContain(KEY);
});

test("a Referer header carrying a fragment is scrubbed", () => {
  const event = scrubEvent({ request: { url: "/seat/abc", headers: { href: LINK } } });
  expect(JSON.stringify(event)).not.toContain(KEY);
});

test("extra context is scrubbed", () => {
  const event = scrubEvent({ extra: { url: LINK } });
  expect(JSON.stringify(event)).not.toContain(KEY);
});

test("the event is returned rather than dropped", () => {
  // Returning null would discard the report. An error worth reporting is still
  // worth reporting once its secrets are gone.
  const event = scrubEvent({ request: { url: LINK } });
  expect(event).not.toBeNull();
  expect(event.request?.url).toContain("/seat/abc123");
});

test("an event with nothing to scrub passes through unharmed", () => {
  const event = scrubEvent({ breadcrumbs: [{}], request: { url: "/seating" } });
  expect(event.request?.url).toBe("/seating");
});
