import { describe, expect, it } from "vitest";
import { contentKey, deleteBlob, getBlob, memoryBackend, missingKeys, putBlob } from "./blobStore";

describe("blobStore", () => {
  it("stores and retrieves by key", async () => {
    const backend = memoryBackend();
    const key = await putBlob("logo", new Blob(["monogram"]), backend);
    const back = await getBlob(key, backend);
    expect(await back?.text()).toBe("monogram");
  });

  it("gives identical bytes the same key", async () => {
    const backend = memoryBackend();
    const first = await putBlob("font", new Blob(["same"]), backend);
    const second = await putBlob("font", new Blob(["same"]), backend);
    const other = await putBlob("font", new Blob(["different"]), backend);
    expect(first).toBe(second);
    expect(other).not.toBe(first);
    expect(first.startsWith("font-")).toBe(true);
  });

  it("returns null for a key that is not there, rather than throwing", async () => {
    expect(await getBlob("logo-deadbeef", memoryBackend())).toBeNull();
  });

  it("reports the keys a document references but the store does not hold", async () => {
    const backend = memoryBackend();
    const key = await putBlob("logo", new Blob(["here"]), backend);
    expect(await missingKeys([key, "font-missing"], backend)).toEqual(["font-missing"]);
  });

  it("deletes", async () => {
    const backend = memoryBackend();
    const key = await putBlob("logo", new Blob(["gone"]), backend);
    await deleteBlob(key, backend);
    expect(await getBlob(key, backend)).toBeNull();
  });

  it("hashes content, not identity", async () => {
    const bytes = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await contentKey("logo", bytes)).toBe(await contentKey("logo", bytes));
  });
});
