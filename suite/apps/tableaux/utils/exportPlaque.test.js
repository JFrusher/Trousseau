import { describe, it, expect } from 'vitest'
import { buildPlaceCardTable } from './exportPlaque.js'

const guest = (id, extra = {}) => ({
  id,
  firstName: '',
  lastName: '',
  fullName: '',
  side: null,
  rsvpStatus: 'confirmed',
  dietary: '',
  notes: '',
  groupId: null,
  subgroupId: null,
  familyId: null,
  ...extra,
})

const table = (id, label, assignedGuestIds, extra = {}) => ({
  id,
  label,
  seatMode: 'table',
  assignedGuestIds,
  ...extra,
})

describe('buildPlaceCardTable', () => {
  it('only includes guests assigned to a table', () => {
    const { rows } = buildPlaceCardTable({
      guests: {
        g1: guest('g1', { firstName: 'Amy', lastName: 'Lee' }),
        g2: guest('g2', { firstName: 'Bob', lastName: 'Ng' }),
      },
      tables: { t1: table('t1', 'Table 1', ['g1']) },
      groups: {},
      subgroups: {},
      families: {},
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('Amy')
  })

  it('headers match Plaque\'s auto-detect patterns for the fixed columns', () => {
    const { headers } = buildPlaceCardTable(
      { guests: {}, tables: {}, groups: {}, subgroups: {}, families: {} },
      { dietary: true, seat: false, notes: false, side: false, family: false }
    )
    expect(headers).toEqual(['First Name', 'Last Name', 'Table', 'Dietary'])
  })

  it('falls back to fullName when firstName is blank', () => {
    const { rows } = buildPlaceCardTable({
      guests: { g1: guest('g1', { fullName: 'Cleo' }) },
      tables: { t1: table('t1', 'Table 1', ['g1']) },
      groups: {},
      subgroups: {},
      families: {},
    })
    expect(rows[0][0]).toBe('Cleo')
    expect(rows[0][1]).toBe('')
  })

  it('reads the seat number only for seat-mode tables', () => {
    const { headers, rows } = buildPlaceCardTable(
      {
        guests: {
          g1: guest('g1', { fullName: 'Amy' }),
          g2: guest('g2', { fullName: 'Bob' }),
        },
        tables: {
          t1: table('t1', 'Table 1', ['g1'], { seatMode: 'seat' }),
          t2: table('t2', 'Table 2', ['g2'], { seatMode: 'table' }),
        },
        groups: {},
        subgroups: {},
        families: {},
      },
      { dietary: false, seat: true, notes: false, side: false, family: false }
    )
    const seatCol = headers.indexOf('Seat')
    expect(rows[0][seatCol]).toBe('1')
    expect(rows[1][seatCol]).toBe('')
  })

  it('omits optional columns when toggled off', () => {
    const { headers } = buildPlaceCardTable(
      { guests: {}, tables: {}, groups: {}, subgroups: {}, families: {} },
      { dietary: false, seat: false, notes: false, side: false, family: false }
    )
    expect(headers).toEqual(['First Name', 'Last Name', 'Table'])
  })

  it('includes Group, Subgroup and Family together', () => {
    const { headers, rows } = buildPlaceCardTable(
      {
        guests: {
          g1: guest('g1', { fullName: 'Amy', groupId: 'gr1', subgroupId: 'sg1', familyId: 'f1' }),
        },
        tables: { t1: table('t1', 'Table 1', ['g1']) },
        groups: { gr1: { name: 'Smiths' } },
        subgroups: { sg1: { name: 'Cousins' } },
        families: { f1: { name: 'Smith family' } },
      },
      { dietary: false, seat: false, notes: false, side: false, family: true }
    )
    expect(headers.slice(-3)).toEqual(['Group', 'Subgroup', 'Family'])
    expect(rows[0].slice(-3)).toEqual(['Smiths', 'Cousins', 'Smith family'])
  })
})
