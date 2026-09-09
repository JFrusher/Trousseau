import * as fontkit from "fontkit";

/**
 * Reads the family name out of the file itself, so the picker is honest.
 *
 * Isolated from fontLoader.ts on purpose: this is the only thing in this
 * tool's font handling that actually needs `fontkit`, and it only runs on
 * upload (addFont) — restoreFonts, which runs unconditionally on mount, never
 * calls this. Keeping it in its own module means fontkit's parser only loads
 * when someone uploads a font, not on every page visit.
 */
export function familyOf(bytes: Uint8Array): string | null {
  try {
    const font = fontkit.create(bytes as unknown as Buffer);
    const named = font as unknown as { familyName?: string; fullName?: string };
    return named.familyName ?? named.fullName ?? null;
  } catch {
    return null;
  }
}
