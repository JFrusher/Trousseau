import { BUNDLED_FONTS, type BundledFont } from "../assets/fonts";
import { loadFont, type LoadedFont } from "../core/text/measure";

/**
 * Static files under `public/`, served from this app's own origin — nothing
 * here reaches out to a font CDN, which would break the zero-backend promise
 * and leak that the page was opened.
 *
 * Vite rewrote a directory glob to hashed URLs at build time; Next serves
 * `public/` verbatim, so the path is the filename.
 */
function urlFor(font: BundledFont): string {
  return `/fonts/${font.file}`;
}

const registered = new Set<string>();

/**
 * Parses a font once and uses the SAME bytes twice: fontkit measures with them,
 * and the browser renders the preview with them via FontFace. One binary, one
 * source of truth, no chance of the preview using a different cut of the face
 * than the PDF embeds.
 */
export async function registerFont(
  id: string,
  family: string,
  data: Uint8Array,
): Promise<LoadedFont> {
  const font = loadFont(id, family, data);
  if (typeof FontFace !== "undefined" && typeof document !== "undefined" && !registered.has(family)) {
    // Guarded: development re-runs the loading effect, and adding the same
    // family twice leaves duplicate faces in the document for the session.
    registered.add(family);
    try {
      // Copy: FontFace detaches the buffer it is handed.
      const face = new FontFace(family, new Uint8Array(data).buffer as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
    } catch (e) {
      registered.delete(family);
      throw e;
    }
  }
  return font;
}

export async function loadBundledFonts(): Promise<Map<string, LoadedFont>> {
  const entries = await Promise.all(
    BUNDLED_FONTS.map(async (f) => {
      const response = await fetch(urlFor(f));
      if (!response.ok) throw new Error(`Could not load ${f.label}`);
      const data = new Uint8Array(await response.arrayBuffer());
      return [f.id, await registerFont(f.id, f.family, data)] as const;
    }),
  );
  return new Map(entries);
}
