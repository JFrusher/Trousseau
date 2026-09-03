import { checkCrossSlice } from "./crossSliceValidation";
import type { DocumentStore } from "./store";

export interface Reply {
  status: number;
  body: unknown;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const conflict = (body: unknown): Reply => ({ status: 409, body });
const invalid = (body: unknown): Reply => ({ status: 422, body });

export async function getDocumentHandler(store: DocumentStore, weddingId: string): Promise<Reply> {
  const record = await store.getDocument(weddingId);
  return ok({ document: record?.document ?? null, version: record?.version ?? 0 });
}

/**
 * Validate first — pure, and depends only on the incoming document — then
 * attempt the compare-and-set write. An error-level cross-slice violation is
 * rejected before the store is ever touched, so a write that was going to be
 * refused anyway never becomes a database round trip. A genuine CAS conflict
 * is only ever reported by `store.saveDocument`'s own return value: it is the
 * one authority on "does the expected version still match," since it runs
 * the check and the write as one atomic operation. Nothing here does its own
 * separate version pre-check, which would be a check-then-act race.
 */
export async function saveDocumentHandler(
  store: DocumentStore,
  weddingId: string,
  document: unknown,
  expectedVersion: number,
): Promise<Reply> {
  const validation = checkCrossSlice(document);
  if (validation.errors.length > 0) {
    return invalid({ error: "That wedding is not valid.", errors: validation.errors, warnings: validation.warnings });
  }

  const result = await store.saveDocument(weddingId, document, expectedVersion);
  if (!result.accepted) {
    return conflict({
      error: "Someone else saved a change to this wedding. Refresh and reapply your change.",
      version: result.record.version,
      document: result.record.document,
    });
  }

  return ok({ version: result.record.version, warnings: validation.warnings });
}
