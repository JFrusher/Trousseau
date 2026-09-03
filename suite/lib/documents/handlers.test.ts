import { describe, expect, it, vi } from "vitest";
import { getDocumentHandler, saveDocumentHandler } from "./handlers";
import { memoryStore } from "./store";

const validDoc = {
  event: { date: "2026-06-20", coupleNames: "Alice & Bob" },
  day: null,
  guests: {},
  seating: { tables: {} },
  sources: {},
};

describe("getDocumentHandler", () => {
  it("returns version 0 and a null document when nothing has been saved yet", async () => {
    const store = memoryStore();
    const reply = await getDocumentHandler(store, "w1");
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ document: null, version: 0 });
  });

  it("returns the stored document and version once one exists", async () => {
    const store = memoryStore();
    await saveDocumentHandler(store, "w1", validDoc, 0);
    const reply = await getDocumentHandler(store, "w1");
    expect(reply.status).toBe(200);
    expect((reply.body as { version: number }).version).toBe(1);
  });
});

describe("saveDocumentHandler", () => {
  it("accepts a valid document at the right expected version", async () => {
    const store = memoryStore();
    const reply = await saveDocumentHandler(store, "w1", validDoc, 0);
    expect(reply.status).toBe(200);
    expect((reply.body as { version: number }).version).toBe(1);
  });

  it("rejects a stale expected version with a 409 and the true current state", async () => {
    const store = memoryStore();
    await saveDocumentHandler(store, "w1", validDoc, 0);

    const reply = await saveDocumentHandler(store, "w1", { ...validDoc, event: { ...validDoc.event, coupleNames: "stale write" } }, 0);
    expect(reply.status).toBe(409);
    const body = reply.body as { version: number; document: unknown };
    expect(body.version).toBe(1);
    expect(body.document).toMatchObject({ event: { coupleNames: "Alice & Bob" } });
  });

  it("rejects an error-level cross-slice violation with a 422, without touching the store", async () => {
    const store = memoryStore();
    const saveSpy = vi.spyOn(store, "saveDocument");
    const invalid = {
      ...validDoc,
      guests: { g1: { id: "g1", fullName: "G1", rsvpStatus: "confirmed", dietaryRaw: "No" } },
      seating: { tables: { t1: { id: "t1", label: "T1", capacity: 8, assignedGuestIds: ["ghost"] } } },
    };
    const reply = await saveDocumentHandler(store, "w1", invalid, 0);
    expect(reply.status).toBe(422);
    expect((reply.body as { errors: string[] }).errors[0]).toContain("ghost");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("accepts a document with only a warning-level violation, and reports the warning", async () => {
    const store = memoryStore();
    const withUnseated = {
      ...validDoc,
      guests: { g1: { id: "g1", fullName: "G1", rsvpStatus: "confirmed", dietaryRaw: "No" } },
    };
    const reply = await saveDocumentHandler(store, "w1", withUnseated, 0);
    expect(reply.status).toBe(200);
    expect((reply.body as { warnings: string[] }).warnings[0]).toContain("no table");
  });
});
