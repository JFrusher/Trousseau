import { BUNDLED_FONTS } from "../../assets/fonts";
import type { FontBytes } from "./embedFonts";

/**
 * Where the font bytes come from. The browser reads them from the app's own
 * build output; Node reads the same files off disk for the headless render and
 * the tests. One interface so the renderers never care which.
 */
export type FontSource = (family: string) => Promise<FontBytes>;

/**
 * Making a PDF is the only thing this app ever puts on the network, and it is
 * same-origin. So the one way it fails is the origin not being there: a tab
 * left open after its dev server moved port, or a laptop that went offline
 * after the page loaded. "Failed to fetch" tells nobody that; this does.
 */
async function read(url: string, family: string): Promise<Uint8Array> {
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) {
    throw new Error(
      `The ${family} font could not be read from this app's own files. ` +
        `Reload the page and try again — it was loaded from a server that is no longer answering.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Reads bundled faces in the browser. Uploaded faces come from the blob store. */
export function browserFontSource(uploaded: Map<string, Uint8Array> = new Map()): FontSource {
  return async (family) => {
    const custom = uploaded.get(family);
    if (custom) return { family, data: custom };

    const bundled = BUNDLED_FONTS.find((font) => font.family === family) ?? BUNDLED_FONTS[0];
    if (!bundled) throw new Error("No fonts are bundled with this build.");

    return {
      family: bundled.family,
      data: await read(bundled.url, bundled.family),
      ...(bundled.boldUrl ? { bold: await read(bundled.boldUrl, bundled.family) } : {}),
    };
  };
}
