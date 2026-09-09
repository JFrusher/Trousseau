import { acceptAsset, collectAssets, heldAssetIds } from "@/lib/sync/assets";
import { browserClient } from "@/lib/accounts/browserClient";

/**
 * Fonts and artwork, over Supabase Storage instead of the encrypted
 * Postgres-row transport lib/sync/assets.ts's caller (lib/sync/client.ts)
 * uses. Reuses the same per-tool asset registry - the wedding-assets bucket
 * only wants opaque bytes under stable ids, exactly like the old transport
 * did.
 */

export interface AssetSyncResult {
  uploaded: number;
  downloaded: number;
}

const BUCKET = "wedding-assets";

export async function syncAssets(weddingId: string): Promise<AssetSyncResult> {
  const client = browserClient();
  if (!client) return { uploaded: 0, downloaded: 0 };
  const bucket = client.storage.from(BUCKET);

  // A failed list is not "the bucket is empty". Treating it as empty
  // re-uploads every font this device holds and downloads nothing, on every
  // sync, with nobody any the wiser — so a failure here stops the whole
  // exchange instead.
  //
  // ponytail: `list` pages at 100 objects and this reads only the first page.
  // Beyond 100 assets for one wedding the rest are invisible: pass
  // `{ limit, offset }` in a loop if a wedding ever gets that many.
  const { data: listed, error: listError } = await bucket.list(weddingId);
  if (listError) return { uploaded: 0, downloaded: 0 };
  const onServer = new Set((listed ?? []).map((entry) => entry.name));

  let uploaded = 0;
  for (const asset of await collectAssets()) {
    if (onServer.has(asset.id)) continue;
    const { error } = await bucket.upload(`${weddingId}/${asset.id}`, asset.bytes, { upsert: true });
    if (!error) {
      onServer.add(asset.id);
      uploaded += 1;
    }
  }

  const held = new Set(await heldAssetIds());
  let downloaded = 0;
  for (const id of onServer) {
    if (held.has(id)) continue;
    const { data, error } = await bucket.download(`${weddingId}/${id}`);
    if (error || !data) continue;
    await acceptAsset(id, new Uint8Array(await data.arrayBuffer()));
    downloaded += 1;
  }

  return { uploaded, downloaded };
}
