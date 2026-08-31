/**
 * A small, dependency-free CSV reader and writer.
 *
 * Lifted from Tableaux's `server/lib/csv.js`, which already handled the things
 * that bite: quoted fields, escaped quotes, embedded commas and newlines, CRLF,
 * and a BOM. Nothing here needs a parser dependency, and adding one would mean
 * shipping it to the browser for a hundred lines of work.
 */

export interface CsvTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

/**
 * The tokenizer: text to rows of raw cells, header row included.
 *
 * Exposed separately because two callers want two shapes of the same parse —
 * the guest importer wants records keyed by header, the stationery tool wants
 * the ragged rows so it can report which ones were ragged. One tokenizer, so
 * they can never disagree about what the file said.
 *
 * @throws if a quoted field is never closed. A stray `"` in a pasted notes
 * field otherwise swallows the rest of the file into one giant record, which
 * previews as plausible-looking but silently wrong data — far worse than a
 * message naming the line to fix.
 */
export function parseRecords(text: string): string[][] {
  const clean = String(text).replace(/^﻿/, "");
  const delimiter = sniffDelimiter(clean);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let quoteOpenedAtLine = 0;
  let line = 1;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "\n") line++;
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      quoteOpenedAtLine = line;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (ch === "\r") {
      // swallowed; \r\n is handled by the \n branch
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new Error(
      `Unterminated quote starting on line ${quoteOpenedAtLine}. Check for a stray " in that row.`,
    );
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Greedy: a record whose every cell is blank is a blank line, not a guest.
  // Spreadsheet exports end with one, and often carry a few in the middle.
  return records.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Which character separates the fields.
 *
 * A European spreadsheet exports with semicolons and a copied-from-a-table
 * paste arrives tab separated; both are called CSV by the person holding them.
 * Decided from the first line only, and counted outside quotes, so a comma
 * inside a quoted name cannot outvote the real delimiter.
 */
function sniffDelimiter(text: string): string {
  const breakAt = text.indexOf("\n");
  const firstLine = (breakAt === -1 ? text : text.slice(0, breakAt)).replace(/\r$/, "");
  let best = ",";
  let bestCount = 0;

  for (const candidate of [",", ";", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** The same parse, keyed by header. Blank lines are dropped. */
export function parseCsv(text: string): CsvTable {
  const records = parseRecords(text);
  const headerRow = records[0];
  if (!headerRow) return { headers: [], rows: [] };

  const headers = dedupe(headerRow.map((h) => h.trim()));
  const rows = records
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? "").trim();
      });
      return obj;
    });

  return { headers, rows };
}

/**
 * Two columns called "Notes" — routine in a merged RSVP export — would have the
 * second silently overwrite the first for every row. Renaming keeps both, and
 * makes the duplicate visible in the mapping dropdown rather than showing two
 * indistinguishable options.
 */
function dedupe(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const name = header || `Column ${index + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

/**
 * Cells beginning with these characters can be executed as formulas by Excel
 * and Google Sheets. Prefixing with a quote neutralises the injection.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function toCsv(headers: string[], rows: string[][]): string {
  const esc = (v: unknown): string => {
    let s = v == null ? "" : String(v);
    if (FORMULA_LEAD.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map(esc).join(",");
  const body = rows.map((row) => row.map(esc).join(",")).join("\r\n");
  return `${head}\r\n${body}${body ? "\r\n" : ""}`;
}
