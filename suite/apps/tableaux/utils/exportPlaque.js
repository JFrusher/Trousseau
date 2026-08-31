import { toCsv } from './exportCsv.js'
import { downloadFile, slug } from './exportJson.js'

const sideLabel = (side) => ({ bride: "Bride's", groom: "Groom's", both: 'Both' })[side] || ''

export const PLAQUE_EXPORT_DEFAULTS = {
  dietary: true,
  seat: true,
  notes: true,
  side: true,
  family: true,
}

/**
 * Seated guests, shaped for a Plaque place-card CSV import. "First Name",
 * "Last Name", "Table" and "Dietary" match Plaque's own column auto-detect
 * (src/core/csv/guessMapping.ts) so those bindings fill in with no remapping.
 */
export function buildPlaceCardTable(state, options = {}) {
  const opts = { ...PLAQUE_EXPORT_DEFAULTS, ...options }
  const { guests = {}, tables = {}, groups = {}, subgroups = {}, families = {} } = state

  const headers = ['First Name', 'Last Name', 'Table']
  if (opts.dietary) headers.push('Dietary')
  if (opts.seat) headers.push('Seat')
  if (opts.notes) headers.push('Notes')
  if (opts.side) headers.push('Side')
  if (opts.family) headers.push('Group', 'Subgroup', 'Family')

  const tableList = Object.values(tables).sort((a, b) =>
    String(a.label).localeCompare(String(b.label), undefined, { numeric: true })
  )

  const rows = []
  for (const t of tableList) {
    for (const [idx, gid] of (t.assignedGuestIds || []).entries()) {
      const g = guests[gid]
      if (!g) continue
      const row = [g.firstName || g.fullName, g.lastName || '', t.label]
      if (opts.dietary) row.push(g.dietary || '')
      if (opts.seat) row.push(t.seatMode === 'seat' ? String(idx + 1) : '')
      if (opts.notes) row.push(g.notes || '')
      if (opts.side) row.push(sideLabel(g.side))
      if (opts.family) {
        row.push(
          groups[g.groupId]?.name || '',
          subgroups[g.subgroupId]?.name || '',
          families[g.familyId]?.name || ''
        )
      }
      rows.push(row)
    }
  }

  return { headers, rows }
}

export function buildPlaceCardCsv(state, options) {
  const { headers, rows } = buildPlaceCardTable(state, options)
  return toCsv(headers, rows)
}

export function exportPlaceCardsCsv(state, name, options) {
  downloadFile(`${slug(name)}-placecards.csv`, buildPlaceCardCsv(state, options), 'text/csv')
}
