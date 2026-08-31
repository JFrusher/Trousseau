import { get, set, del } from "idb-keyval";

/**
 * A live link from this app to one real file on disk.
 *
 * The document is kept in localStorage as it always has been — that is still
 * the source of truth for this browser. This is a second, optional write to a
 * file the user picks once, so a folder that syncs between machines (OneDrive,
 * say) always holds the current day without anyone remembering to export it.
 *
 * The File System Access API only exists in Chromium browsers. Everywhere else
 * `isSupported()` is false and the app behaves exactly as before.
 */

const HANDLE_KEY = "cadence.fileSink.handle.v1";

/** Minimal shape of the bits of the API we use, so this compiles without DOM lib updates. */
interface FileHandle {
  name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

type PickerWindow = Window & {
  showSaveFilePicker(options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<FileHandle>;
};

export function isSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

let handle: FileHandle | null = null;

/** The name of the linked file, or null when nothing is linked. */
export function linkedName(): string | null {
  return handle?.name ?? null;
}

/**
 * Ask for a file and remember it. Must be called from a click — the browser
 * refuses to open the picker otherwise.
 */
export async function connect(suggestedName = "day.cadence.json"): Promise<string | null> {
  if (!isSupported()) return null;
  try {
    handle = await (window as unknown as PickerWindow).showSaveFilePicker({
      suggestedName,
      types: [{ description: "Cadence day", accept: { "application/json": [".json"] } }],
    });
    await set(HANDLE_KEY, handle);
    return handle.name;
  } catch {
    // The user dismissed the picker. Not an error worth reporting.
    return null;
  }
}

/** Forget the link. The file itself is left alone. */
export async function disconnect(): Promise<void> {
  handle = null;
  await del(HANDLE_KEY);
}

/**
 * Re-attach to the file chosen in an earlier session, if the browser will still
 * allow it without asking. Chromium keeps the grant for a while but not
 * forever; when it has lapsed this returns null and the user clicks once to
 * re-link. It never prompts, because a prompt without a gesture is refused.
 */
export async function reconnect(): Promise<string | null> {
  if (!isSupported()) return null;
  const saved = await get<FileHandle>(HANDLE_KEY);
  if (!saved) return null;
  try {
    if ((await saved.queryPermission({ mode: "readwrite" })) !== "granted") return null;
    handle = saved;
    return handle.name;
  } catch {
    return null;
  }
}

/** Re-ask for permission on a remembered file. Must be called from a click. */
export async function reauthorise(): Promise<string | null> {
  if (!isSupported()) return null;
  const saved = await get<FileHandle>(HANDLE_KEY);
  if (!saved) return null;
  try {
    if ((await saved.requestPermission({ mode: "readwrite" })) !== "granted") return null;
    handle = saved;
    return handle.name;
  } catch {
    return null;
  }
}

/** True when a file is remembered but not currently writable. */
export async function needsReauthorising(): Promise<boolean> {
  if (!isSupported() || handle !== null) return false;
  return (await get<FileHandle>(HANDLE_KEY)) !== undefined;
}

/**
 * Write the document out. Returns false if there is no link or the write
 * failed — the caller decides whether that is worth telling the user about.
 * localStorage has already been written by then either way, so a failure here
 * never loses work.
 */
export async function write(text: string): Promise<boolean> {
  if (handle === null) return false;
  try {
    const stream = await handle.createWritable();
    await stream.write(text);
    await stream.close();
    return true;
  } catch {
    handle = null; // The file was moved, deleted, or the grant lapsed.
    return false;
  }
}
