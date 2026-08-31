import * as XLSX from 'xlsx'
import { slug, downloadFile } from './exportJson.js'

const sortKey = (s) => String(s || '').toLowerCase()

/** One row per non-declined guest: big group / subgroup / family / full name / table. */
export function buildGroupSheetRows(state) {
  const { guests = {}, groups = {}, subgroups = {}, families = {}, tables = {} } = state
  const headers = ['Group', 'Subgroup', 'Family', 'Guest', 'Table']

  const tableByGuestId = {}
  Object.values(tables).forEach((t) => {
    ;(t.assignedGuestIds || []).forEach((gid) => {
      if (gid) tableByGuestId[gid] = t.label
    })
  })

  const rows = Object.values(guests)
    .filter((g) => g.rsvpStatus !== 'declined')
    .map((g) => ({
      group: groups[g.groupId]?.name || '',
      subgroup: subgroups[g.subgroupId]?.name || '',
      family: families[g.familyId]?.name || '',
      name: g.fullName,
      table: tableByGuestId[g.id] || '',
    }))
    .sort(
      (a, b) =>
        sortKey(a.group).localeCompare(sortKey(b.group)) ||
        sortKey(a.subgroup).localeCompare(sortKey(b.subgroup)) ||
        sortKey(a.family).localeCompare(sortKey(b.family)) ||
        sortKey(a.name).localeCompare(sortKey(b.name))
    )
    .map((r) => [r.group, r.subgroup, r.family, r.name, r.table])

  return { headers, rows }
}

export function exportGroupsXlsx(state, name) {
  const { headers, rows } = buildGroupSheetRows(state)
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  sheet['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 14 }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Groups')
  const buf = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
  downloadFile(
    `${slug(name)}-groups.xlsx`,
    buf,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}
