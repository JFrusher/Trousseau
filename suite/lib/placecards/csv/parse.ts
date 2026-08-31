import { parseRecords } from "@/lib/data/csv";

/**
 * Parsing a guest CSV, and saying what was wrong with it.
 *
 * Plaque used papaparse. The suite already carries a dependency-free reader —
 * Tableaux's, in `lib/data/csv` — which handles the same quoted fields, escaped
 * quotes, embedded newlines, CRLF and BOM, and refuses an unterminated quote
 * instead of swallowing the rest of the file. The issue reporting below is
 * Plaque's, unchanged: it is the part that matters, because it is what stops a
 * ragged export losing a guest silently.
 */

/** One guest, keyed by CSV header. Values are trimmed strings — never undefined. */
export type GuestRow = Record<string, string>;

export interface CsvIssue {
  /** 1-based data row, or null for a problem with the file as a whole. */
  row: number | null;
  message: string;
}

export interface ParsedCsv {
  headers: string[];
  rows: GuestRow[];
  issues: CsvIssue[];
}

/**
 * Deliberately forgiving: a wedding guest list is exported from a spreadsheet by
 * someone who is not thinking about data hygiene. Ragged rows are reported and
 * kept, never dropped — losing a guest silently is the worst failure this has.
 */
export function parseCsv(text: string): ParsedCsv {
  const issues: CsvIssue[] = [];

  let records: string[][];
  try {
    records = parseRecords(text);
  } catch (cause) {
    issues.push({ row: null, message: cause instanceof Error ? cause.message : String(cause) });
    return { headers: [], rows: [], issues };
  }

  const [headerRow, ...dataRows] = records;
  if (!headerRow || headerRow.every((h) => h.trim() === "")) {
    issues.push({ row: null, message: "No columns found. Is this a CSV file?" });
    return { headers: [], rows: [], issues };
  }

  const headers = dedupeHeaders(headerRow);

  if (headers.length === 1) {
    issues.push({
      row: null,
      message: `Only one column was found ("${headers[0]}"). If your file separates values with something other than a comma, re-export it as comma-separated.`,
    });
  }

  const rows: GuestRow[] = [];
  for (const [i, values] of dataRows.entries()) {
    const rowNumber = i + 1;
    const row: GuestRow = {};
    headers.forEach((h, col) => {
      row[h] = (values[col] ?? "").trim();
    });

    if (values.length > headers.length) {
      issues.push({
        row: rowNumber,
        message: `Row ${rowNumber} has more values than there are columns. The extras were ignored.`,
      });
    } else if (values.length < headers.length) {
      const missing = headers.slice(values.length);
      issues.push({
        row: rowNumber,
        message: `Row ${rowNumber} is missing ${missing.length === 1 ? "a value" : "values"} for ${missing.join(", ")}. Blank cells were used.`,
      });
    }

    rows.push(row);
  }

  return { headers, rows, issues };
}

/**
 * Blank headers get a positional name and repeats get a suffix, so every column
 * stays addressable as a `{{token}}`. Spreadsheet exports produce both.
 */
function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header, index) => {
    const base = header.replace(/^﻿/, "").trim() || `Column ${index + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}
