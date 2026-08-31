import * as cadence from "@/apps/cadence/state/syncAssets";
import * as plaque from "@/apps/plaque/state/syncAssets";

/**
 * Every uploaded file the wedding depends on, whichever tool it belongs to.
 *
 * Two of the four tools let you upload something the document then refers to by
 * id: Plaque takes typefaces and artwork for the cards, Cadence takes a
 * typeface and a monogram for the day sheet. The sync layer wants none of that
 * detail — it wants opaque bytes under stable ids, which it seals and sends.
 *
 * This is the join. It exists because the sync layer used to ask Plaque
 * directly, which quietly meant Cadence's uploads never left the machine they
 * were added on: the second laptop received a day referring to a monogram it
 * had never been sent, and the export refuses to print that rather than leaving
 * a hole where the monogram should be.
 *
 * Each tool answers for its own ids. A new tool with uploads of its own adds a
 * module here and changes nothing else.
 */

export interface PortableAsset {
  id: string;
  bytes: Uint8Array;
}

interface AssetSource {
  owns(id: string): boolean;
  collectAssets(): Promise<PortableAsset[]>;
  heldAssetIds(): Promise<string[]>;
  acceptAsset(id: string, bytes: Uint8Array): Promise<void>;
}

const SOURCES: AssetSource[] = [plaque, cadence];

export async function collectAssets(): Promise<PortableAsset[]> {
  const all = await Promise.all(SOURCES.map((source) => source.collectAssets()));
  return all.flat();
}

export async function heldAssetIds(): Promise<string[]> {
  const all = await Promise.all(SOURCES.map((source) => source.heldAssetIds()));
  return all.flat();
}

/**
 * Hands a fetched asset to whichever tool claims its id.
 *
 * An id nobody claims is dropped rather than guessed at. That is the shape of a
 * wedding synced from a newer version of the suite with a tool this one does
 * not have, and storing those bytes somewhere arbitrary would be worse than
 * ignoring them — the tool that wants them is not here to read them anyway.
 */
export async function acceptAsset(id: string, bytes: Uint8Array): Promise<void> {
  for (const source of SOURCES) {
    if (source.owns(id)) {
      await source.acceptAsset(id, bytes);
      return;
    }
  }
}
