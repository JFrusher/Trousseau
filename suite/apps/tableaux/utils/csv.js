/**
 * A small, dependency-free CSV reader. Handles quoted fields, escaped quotes
 * (""), embedded commas/newlines, and CRLF or LF endings.
 *
 * This ran on Tableaux's server, which is why the import used to be an upload.
 * It is the same code, moved rather than rewritten: it is the only thing that
 * knows a stray quote should be an error naming the line rather than a file
 * silently swallowed into one giant record, and the import flow shows that
 * message. A guest list is also exactly the kind of thing that should not need
 * to leave the device to be read.
 */

/**
 * @throws if a quoted field is never closed. A stray `"` in a pasted notes
 * field otherwise swallows the rest of the file into one giant record, which
 * previews as plausible-looking but silently wrong data — far worse than a
 * message telling the user which line to fix.
 */
export function parseCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '') // strip BOM
  const rows = []
  let field = ''
  let record = []
  let inQuotes = false
  let quoteOpenedAtLine = 0
  let line = 1

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === '\n') line++
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
      quoteOpenedAtLine = line
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n') {
      record.push(field)
      rows.push(record)
      record = []
      field = ''
    } else if (ch === '\r') {
      // swallow; \r\n handled by the \n branch
    } else {
      field += ch
    }
  }
  if (inQuotes) {
    const err = new Error(
      `Unterminated quote starting on line ${quoteOpenedAtLine}. Check for a stray " in that row.`
    )
    err.status = 400
    throw err
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field)
    rows.push(record)
  }

  if (rows.length === 0) return { headers: [], rows: [] }

  const headers = rows[0].map((h) => h.trim())
  const dataRows = rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== '')) // skip blank lines
    .map((r) => {
      const obj = {}
      // TODO(ux-audit): duplicate column headers (e.g. two "Notes" columns
      // from a merged export) silently overwrite here: the second write wins
      // for every row, no dedup/rename, no warning. The client's mapping
      // dropdown also renders indistinguishable duplicate <option>s for the
      // same reason. See tmp/ux-audit.md #G14.
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? '').trim()
      })
      return obj
    })

  return { headers, rows: dataRows }
}
