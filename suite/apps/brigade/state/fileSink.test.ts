// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// idb-keyval talks to IndexedDB, which jsdom does not have. One in-memory map
// stands in for it; the module under test only ever stores the one handle.
const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => void store.set(k, v),
  del: async (k: string) => void store.delete(k),
}));

const { connect, disconnect, isSupported, linkedName, needsReauthorising, reauthorise, reconnect, write } =
  await import("./fileSink");

/** A stand-in for a FileSystemFileHandle, recording what was written to it. */
const fakeHandle = (name = "crew.brigade.json", permission: PermissionState = "granted") => {
  const written: string[] = [];
  return {
    name,
    written,
    createWritable: async () => ({
      write: async (data: string) => void written.push(data),
      close: async () => {},
    }),
    queryPermission: async () => permission,
    requestPermission: async () => permission,
  };
};

const givePicker = (handle: unknown) => {
  (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => handle);
};

beforeEach(() => store.clear());
afterEach(async () => {
  await disconnect();
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
});

describe("when the browser has no File System Access API", () => {
  it("reports itself unsupported and does nothing", async () => {
    expect(isSupported()).toBe(false);
    expect(await connect()).toBeNull();
    expect(await reconnect()).toBeNull();
    expect(await write("{}")).toBe(false);
  });
});

describe("connecting", () => {
  it("remembers the chosen file and writes to it", async () => {
    const handle = fakeHandle();
    givePicker(handle);

    expect(await connect()).toBe("crew.brigade.json");
    expect(linkedName()).toBe("crew.brigade.json");
    expect(await write('{"a":1}')).toBe(true);
    expect(handle.written).toEqual(['{"a":1}']);
  });

  it("stays unlinked when the user dismisses the picker", async () => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });
    expect(await connect()).toBeNull();
    expect(linkedName()).toBeNull();
  });

  it("disconnect forgets the file", async () => {
    givePicker(fakeHandle());
    await connect();
    await disconnect();
    expect(linkedName()).toBeNull();
    expect(await write("{}")).toBe(false);
  });
});

describe("coming back in a later session", () => {
  it("re-attaches silently when the grant is still good", async () => {
    givePicker(fakeHandle("kept.json", "granted"));
    await connect();
    await disconnect_keepingStorage();

    expect(await reconnect()).toBe("kept.json");
  });

  it("does not re-attach when the grant has lapsed, and asks to be re-authorised", async () => {
    givePicker(fakeHandle("lapsed.json", "prompt"));
    await connect();
    await disconnect_keepingStorage();

    expect(await reconnect()).toBeNull();
    expect(await needsReauthorising()).toBe(true);
  });

  it("re-authorising re-attaches when the user says yes", async () => {
    givePicker(fakeHandle("again.json", "granted"));
    await connect();
    await disconnect_keepingStorage();

    expect(await reauthorise()).toBe("again.json");
    expect(linkedName()).toBe("again.json");
  });
});

describe("when writing fails", () => {
  it("drops the link rather than retrying a file that has gone", async () => {
    const broken = {
      name: "gone.json",
      createWritable: async () => {
        throw new DOMException("not found", "NotFoundError");
      },
      queryPermission: async () => "granted" as PermissionState,
      requestPermission: async () => "granted" as PermissionState,
    };
    givePicker(broken);
    await connect();

    expect(await write("{}")).toBe(false);
    expect(linkedName()).toBeNull();
  });
});

/** Clear the in-memory handle without wiping what IndexedDB remembers. */
async function disconnect_keepingStorage() {
  const kept = store.get("brigade.fileSink.handle.v1");
  await disconnect();
  store.set("brigade.fileSink.handle.v1", kept);
}
