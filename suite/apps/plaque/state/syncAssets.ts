import { loadFonts, saveFont } from "./blobStore";
import { loadImages, saveImage } from "./imageStore";
import { readSlice } from "./sliceBridge";

/**
 * Plaque's uploaded fonts and artwork, for the sync layer.
 *
 * Plaque keeps each in its own IndexedDB store with its own shape — a font
 * carries its family name, an image its mime type and dimensions. The sync
 * layer only wants opaque bytes under stable ids, so this is the one place that
 * translates between the two, rather than teaching either about the other.
 *
 * Without this, a design synced to the second machine references artwork that
 * machine has not got — and the export deliberately refuses to print a card
 * with a gap where a monogram should be, so the design would be unusable there.
 */

/** Prefixes, so a font and an image can never collide on one id. */
const FONT = "plaque.font.";
const IMAGE = "plaque.image.";

export interface PortableAsset {
  id: string;
  bytes: Uint8Array;
}

/** True for ids this module owns, so the aggregator knows where to send them. */
export function owns(id: string): boolean {
  return id.startsWith(FONT) || id.startsWith(IMAGE);
}

/** Everything this design has uploaded, ready to encrypt and send. */
export async function collectAssets(): Promise<PortableAsset[]> {
  const out: PortableAsset[] = [];
  for (const font of await loadFonts()) out.push({ id: FONT + font.id, bytes: font.data });
  for (const image of await loadImages()) out.push({ id: IMAGE + image.id, bytes: image.data });
  return out;
}

/** The ids this machine already holds, so nothing is fetched twice. */
export async function heldAssetIds(): Promise<string[]> {
  const fonts = await loadFonts();
  const images = await loadImages();
  return [...fonts.map((f) => FONT + f.id), ...images.map((i) => IMAGE + i.id)];
}

/**
 * Put a fetched asset back where Plaque expects it.
 *
 * The original filename comes from the design's own `assetNames`, which travels
 * in the slice — so it is already here, and sending it a second time alongside
 * the bytes would only create something that could disagree with it. The
 * dimensions are recoverable from the file itself for the same reason.
 */
export async function acceptAsset(id: string, bytes: Uint8Array): Promise<void> {
  if (id.startsWith(FONT)) {
    const fontId = id.slice(FONT.length);
    const fileName = nameOf(fontId) ?? `${fontId}.ttf`;
    await saveFont({ id: fontId, family: fileName.replace(/\.[a-z0-9]+$/i, ""), fileName, data: bytes });
    return;
  }
  if (id.startsWith(IMAGE)) {
    const imageId = id.slice(IMAGE.length);
    const size = await measure(bytes);
    await saveImage({
      id: imageId,
      name: nameOf(imageId) ?? imageId,
      data: bytes,
      mime: sniff(bytes),
      naturalW: size.w,
      naturalH: size.h,
    });
  }
}

/** The filename the user uploaded it under, if the design still remembers. */
function nameOf(assetId: string): string | undefined {
  return readSlice()?.assetNames?.[assetId];
}

/** PNG and JPEG are the two a PDF can carry, so they are the two Plaque takes. */
function sniff(bytes: Uint8Array): "image/png" | "image/jpeg" {
  return bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
}

function measure(bytes: Uint8Array): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve({ w: 0, h: 0 });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    // A picture that will not decode is stored at zero, where the missing-asset
    // report picks it up by name — better than refusing the whole sync.
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ w: 0, h: 0 });
    };
    img.src = url;
  });
}
