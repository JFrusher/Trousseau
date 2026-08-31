// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { sampleDoc } from "../core/model/defaults";
import { clearPersisted, createPersister, persist, restore, STORAGE_KEY } from "./persist";

/**
 * The autosave goes into the shared wedding now, not a key of Cadence's own, so
 * these assert against the `timeline` slice rather than against `localStorage`.
 * The two tests that survive unchanged are the ones about a payload that cannot
 * be read and a browser that refuses to store anything: those describe the
 * legacy standalone autosave, which is still adopted on the way past.
 */
const slice = () =>
  (useTrousseauStore.getState().raw as Record<string, unknown>)["timeline"] as
    | Record<string, unknown>
    | undefined;

beforeEach(() => {
  localStorage.clear();
  // The store refuses writes until the stored wedding has been read, which is
  // the only state a tool ever runs in — `WhenDocumentReady` holds it back until
  // then. Starting from an unread store would test a situation that cannot
  // happen and quietly pass, because every write would be dropped.
  useTrousseauStore.getState().replaceDocument({});
});

describe("restore", () => {
  it("gives an empty day when nothing is saved", () => {
    const { doc, notice } = restore();
    expect(notice).toBeNull();
    // An empty wedding is a readable one, so this is a day with no blocks in it
    // rather than the `null` a missing localStorage key used to mean.
    expect(doc?.blocks).toEqual([]);
  });

  it("brings back the saved day", () => {
    persist(sampleDoc());
    const { doc, notice } = restore();
    expect(notice).toBeNull();
    expect(doc?.blocks.map((b) => b.label)).toEqual(sampleDoc().blocks.map((b) => b.label));
    expect(doc?.lanes).toEqual(sampleDoc().lanes);
  });

  it("starts empty with a notice when the payload is rubbish", () => {
    localStorage.setItem(STORAGE_KEY, "{ this is not json");
    const { doc, notice } = restore();
    expect(doc).toBeNull();
    expect(notice).toMatch(/could not be read/);
  });

  it("survives storage being blocked outright", () => {
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(restore(blocked).notice).toMatch(/blocking local storage/);
  });
});

describe("createPersister", () => {
  it("writes once after the edits stop", () => {
    vi.useFakeTimers();
    const { schedule } = createPersister();

    schedule(sampleDoc());
    schedule(sampleDoc());
    schedule(sampleDoc());
    expect(slice()?.["blocks"]).toBeUndefined();

    vi.advanceTimersByTime(500);
    expect((slice()?.["blocks"] as unknown[]).length).toBe(sampleDoc().blocks.length);

    vi.useRealTimers();
  });

  it("flushes on demand", () => {
    vi.useFakeTimers();
    const { schedule, flush } = createPersister();
    schedule(sampleDoc());
    flush();
    expect((slice()?.["blocks"] as unknown[]).length).toBe(sampleDoc().blocks.length);
    vi.useRealTimers();
  });
});

describe("clearPersisted", () => {
  it("removes the saved day", () => {
    persist(sampleDoc());
    clearPersisted();
    expect(slice()?.["blocks"]).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
