import { BUNDLED_FONTS, bundledFont, DEFAULT_FONT_ID } from "./assets/fonts";
import { getBlob } from "./blobStore";
import { loadFont, type LoadedFont } from "./text/measure";

/**
 * Parsed faces, keyed by font id.
 *
 * One cache for the whole session. The same `Uint8Array` reaches fontkit, the
 * browser's FontFace and pdf-lib, so what is measured, what is previewed and
 * what is embedded cannot be three different fonts.
 */
const parsed = new Map<string, LoadedFont>();
const inFlight = new Map<string, Promise<LoadedFont | null>>();

export function loadedFonts(): Map<string, LoadedFont> {
  return parsed;
}

/**
 * Ensure a face is available.
 *
 * Returns null rather than throwing when a font cannot be found: an uploaded
 * face whose bytes have gone is a normal state after a backup is restored on
 * another machine, and the design should still open, with the missing-font
 * warning the resolver already raises.
 */
export async function ensureFont(id: string, families: Record<string, string> = {}): Promise<LoadedFont | null> {
  const already = parsed.get(id);
  if (already) return already;
  const running = inFlight.get(id);
  if (running) return running;

  const task = (async (): Promise<LoadedFont | null> => {
    try {
      const bundled = bundledFont(id);
      const bytes = bundled
        ? new Uint8Array(await (await fetch(`/fonts/${bundled.file}`)).arrayBuffer())
        : await getBlob(id);
      if (!bytes) return null;

      const font = loadFont(id, bundled?.family ?? families[id] ?? id, bytes);
      parsed.set(id, font);
      registerFace(font);
      return font;
    } catch {
      return null;
    }
  })();

  inFlight.set(id, task);
  try {
    return await task;
  } finally {
    inFlight.delete(id);
  }
}

/** Every face a design needs: the bundled set plus whatever it uploaded. */
export async function ensureFonts(families: Record<string, string>): Promise<Map<string, LoadedFont>> {
  await Promise.all([
    ...BUNDLED_FONTS.map((f) => ensureFont(f.id)),
    ...Object.keys(families).map((id) => ensureFont(id, families)),
  ]);
  return parsed;
}

/** Take a font file the user chose. Returns the id it was stored under. */
export function acceptFont(id: string, family: string, bytes: Uint8Array): LoadedFont {
  const font = loadFont(id, family, bytes);
  parsed.set(id, font);
  registerFace(font);
  return font;
}

/** Make the face available to the browser too, so the preview sets in it. */
function registerFace(font: LoadedFont): void {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  // A fresh copy: FontFace takes ownership of the buffer it is given, and the
  // same bytes still have to reach pdf-lib intact.
  const face = new FontFace(font.family, font.data.slice().buffer as ArrayBuffer);
  void face.load().then(
    (loaded) => document.fonts.add(loaded),
    // The PDF is the deliverable. A preview in a fallback face is a cosmetic
    // loss, not a reason to fail the tool.
    () => undefined,
  );
}

export { DEFAULT_FONT_ID, BUNDLED_FONTS };
