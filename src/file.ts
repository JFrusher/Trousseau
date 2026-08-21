import { ZodError } from "zod";
import { TROUSSEAU_KIND, migrate, type Trousseau } from "./envelope.js";

export const TROUSSEAU_EXTENSION = ".trousseau.json";

/** Indented and newline-terminated: these files end up in git and in email. */
export function serialise(doc: Trousseau): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Read a `.trousseau.json`.
 *
 * Throws with a sentence a person can act on rather than a validation dump.
 * This runs on whatever the user dropped on the window, which is often the
 * wrong file entirely — most usefully, one of the four apps' own save files.
 */
export function parse(text: string): Trousseau {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON. Is it a Trousseau file?");
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("That file is not a Trousseau file.");
  }

  const kind = (raw as Record<string, unknown>)["kind"];
  if (kind !== undefined && kind !== TROUSSEAU_KIND) {
    throw new Error(
      `That is not a Trousseau file — it says it is a "${String(kind)}".`,
    );
  }

  try {
    return migrate(raw);
  } catch (cause) {
    throw new Error(`That Trousseau file could not be read: ${firstIssue(cause)}`, { cause });
  }
}

/** `charis-and-jacob.trousseau.json`, or a sensible fallback. */
export function suggestedFilename(doc: Trousseau): string {
  const slug = doc.event.coupleNames
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "wedding"}${TROUSSEAU_EXTENSION}`;
}

/** The most useful line out of a validation failure, for a person rather than a log. */
function firstIssue(cause: unknown): string {
  if (cause instanceof ZodError) {
    const issue = cause.issues[0];
    if (issue) {
      const where = issue.path.join(".");
      return where ? `${where}: ${issue.message}` : issue.message;
    }
  }
  return "it does not match the expected shape.";
}
