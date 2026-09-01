// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useTrousseauStore } from "./useTrousseauStore";
import { mayWrite, noteRead } from "./toolGeneration";
import { readDoc, writeDoc } from "@/apps/tableaux/store/sliceBridge";

/**
 * The bug this exists to stop:
 *
 *   Restore a wedding from a file while a tool is open. The tool is still
 *   holding the previous one, and its autosave writes that back — so ninety-
 *   seven guests become the four that were there before, under a message
 *   saying the restore worked.
 */

const guestsIn = () =>
  Object.keys(
    (useTrousseauStore.getState().raw as { guests?: Record<string, unknown> }).guests ?? {},
  ).length;

beforeEach(() => {
  useTrousseauStore.getState().replaceDocument({});
});

describe("a tool holding a replaced wedding", () => {
  it("may write what it read", () => {
    noteRead("a-tool");
    expect(mayWrite("a-tool")).toBe(true);
  });

  it("may not write once the document has been swapped underneath it", () => {
    noteRead("a-tool");
    useTrousseauStore.getState().replaceDocument({ guests: { g1: { id: "g1" } } });
    expect(mayWrite("a-tool")).toBe(false);
  });

  it("may write again once it has re-read", () => {
    noteRead("a-tool");
    useTrousseauStore.getState().replaceDocument({ guests: { g1: { id: "g1" } } });
    noteRead("a-tool");
    expect(mayWrite("a-tool")).toBe(true);
  });

  it("does not hold back a tool that has never read", () => {
    // A fresh mount whose own read is moments away. Refusing here would throw
    // away real edits to protect against nothing.
    expect(mayWrite("never-read")).toBe(true);
  });

  it("does not put the old guest list back over a restored one", () => {
    // The whole thing, through a real seam.
    const before = readDoc();
    expect(guestsIn()).toBe(0);

    useTrousseauStore.getState().replaceDocument({
      guests: Object.fromEntries(
        Array.from({ length: 97 }, (_, i) => [`g${i}`, { id: `g${i}`, firstName: "Guest" }]),
      ),
    });
    expect(guestsIn()).toBe(97);

    // The stale instance autosaving on its way out.
    writeDoc(before);

    expect(guestsIn()).toBe(97);
  });
});
