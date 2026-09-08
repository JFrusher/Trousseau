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

  const { data: listed } = await bucket.list(weddingId);
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
