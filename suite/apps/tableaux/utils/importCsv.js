import { parseCsv } from './csv.js'

/** The server's old ceiling, kept: a plan this size is a mistake, not a wedding. */
export const MAX_GUESTS = 5000

/**
 * Reads a chosen CSV into the shape the import flow expects.
 *
 * Stands in for the upload that used to POST the file to Tableaux's server and
 * get back parsed rows. Same parser, same limit, same response shape — it just
 * never leaves the browser now, which is the point: a guest list is the one
 * file in this app that should not have to travel to be read.
 */
export async function readCsvFile(file) {
  const text = await file.text()
  const { headers, rows } = parseCsv(text)
  if (rows.length > MAX_GUESTS) {
    throw new Error(`That file has ${rows.length} rows — the maximum is ${MAX_GUESTS} guests.`)
  }
  return { filename: file.name, headers, rows, rowCount: rows.length }
}
