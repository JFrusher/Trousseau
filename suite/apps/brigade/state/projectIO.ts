import { parse, serialise, suggestedFilename } from "../core/project/file";
import type { BrigadeDoc } from "../core/model/types";

/** Downloads the document as a `.brigade.json` file, the day inside it. */
export function saveProject(doc: BrigadeDoc): void {
  const blob = new Blob([serialise(doc)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedFilename(doc);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export type OpenResult =
  | { doc: BrigadeDoc; fromFuture: boolean; error?: undefined }
  | { error: string; doc?: undefined; fromFuture?: undefined };

export async function openProject(file: File | Blob): Promise<OpenResult> {
  const result = parse(await file.text());
  if (result.error !== undefined) return { error: result.error };
  return { doc: result.doc, fromFuture: result.fromFuture };
}

/** Saves a PDF the app has just made. */
export function download(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
