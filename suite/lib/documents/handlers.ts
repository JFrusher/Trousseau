import { migrate, suggestedFilename, TROUSSEAU_EXTENSION } from "@jfrusher/trousseau";
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

export interface ExportFile {
  filename: string;
  text: string;
}

export type ExportReply = { status: 200; file: ExportFile } | { status: 404; body: unknown };

/**
 * Hand the caller their own wedding as a file.
 *
 * Returns the **stored** document, not a re-validated copy. Every other read
 * path in the suite is free to refuse a document it cannot parse; this one is
 * not, because it is the path a person uses when something has gone wrong and
 * they want their data out. A validator standing between somebody and their
 * own guest list is the single worst failure this endpoint could have.
 */
export async function exportDocumentHandler(
  store: DocumentStore,
  weddingId: string,
): Promise<ExportReply> {
  const record = await store.getDocument(weddingId);
  if (!record || record.document === null || record.document === undefined) {
    return { status: 404, body: { error: "Nothing has been saved to your account yet." } };
  }

  return {
    status: 200,
    file: {
      filename: exportFilename(record.document),
      text: JSON.stringify(record.document, null, 2),
    },
  };
}

/**
 * A name a person will recognise in their downloads folder, falling back
 * rather than throwing. Parsing here is only ever to read the couple's names;
 * if it fails, the document is still exported untouched under a generic name.
 */
function exportFilename(document: unknown): string {
  try {
    return suggestedFilename(migrate(document));
  } catch {
    return `wedding${TROUSSEAU_EXTENSION}`;
  }
}
