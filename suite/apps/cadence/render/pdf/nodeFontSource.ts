import { readFileSync } from "node:fs";
import { BUNDLED_FONTS } from "../../assets/fonts";
import type { FontBytes } from "./embedFonts";
import type { FontSource } from "./fontSource";

/** The same faces, read off disk. For the headless render and the test run. */
export const nodeFontSource: FontSource = async (family): Promise<FontBytes> => {
  const bundled = BUNDLED_FONTS.find((font) => font.family === family) ?? BUNDLED_FONTS[0];
  if (!bundled) throw new Error("No fonts are bundled with this build.");
  return {
    family: bundled.family,
    data: new Uint8Array(readFileSync(bundled.file)),
    ...(bundled.boldFile ? { bold: new Uint8Array(readFileSync(bundled.boldFile)) } : {}),
  };
};
