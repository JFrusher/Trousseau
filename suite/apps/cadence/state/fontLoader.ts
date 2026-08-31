import * as fontkit from "fontkit";
import type { UploadedFont } from "../core/model/types";
import { getBlob, putBlob, type BlobBackend } from "./blobStore";

export interface LoadedFont {
  family: string;
  blobKey: string;
  bytes: Uint8Array;
}

const registered = new Set<string>();

/** Reads the family name out of the file itself, so the picker is honest. */
export function familyOf(bytes: Uint8Array): string | null {
  try {
    const font = fontkit.create(bytes as unknown as Buffer);
    const named = font as unknown as { familyName?: string; fullName?: string };
    return named.familyName ?? named.fullName ?? null;
  } catch {
    return null;
  }
}

export type AddFontResult = { font: UploadedFont; error?: undefined } | { error: string };

/**
 * Takes an uploaded file, checks it is really a font, stores the bytes and
 * registers the face for the screen. A renamed text file is refused here
 * rather than at export time, when it would cost the user a print run.
 */
export async function addFont(file: File | Blob, backend?: BlobBackend): Promise<AddFontResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const family = familyOf(bytes);
  if (!family) {
    return { error: "That file is not a font Cadence can read. Try a .ttf, .otf or .woff2." };
  }

  const blobKey = backend ? await putBlob("font", file, backend) : await putBlob("font", file);
  await registerFace(family, bytes);
  return { font: { family, blobKey } };
}

/** Makes a family usable in the browser's own text rendering. */
export async function registerFace(family: string, bytes: Uint8Array): Promise<void> {
  if (registered.has(family) || typeof FontFace === "undefined") return;
  const face = new FontFace(family, bytes as unknown as BufferSource);
  await face.load();
  document.fonts.add(face);
  registered.add(family);
}

/** Re-registers every uploaded font a document refers to, after a reload. */
export async function restoreFonts(fonts: UploadedFont[]): Promise<string[]> {
  const missing: string[] = [];
  for (const font of fonts) {
    const blob = await getBlob(font.blobKey).catch(() => null);
    if (!blob) {
      missing.push(font.family);
      continue;
    }
    await registerFace(font.family, new Uint8Array(await blob.arrayBuffer()));
  }
  return missing;
}
