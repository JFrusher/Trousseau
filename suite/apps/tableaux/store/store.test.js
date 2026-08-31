import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore.js'

const mkGuest = (id, first, last) => ({
  id,
  firstName: first,
  lastName: last,
  fullName: `${first} ${last}`,
  email: '',
  dietary: '',
  dietaryRaw: '',
  side: null,
  rsvpStatus: 'confirmed',
  plusOneOf: null,
  groupId: null,
  assignedTableId: null,
  assignedSeatId: null,
  notes: '',
  tags: [],
})

const fixture = () => ({
  meta: { weddingName: 'Test', venue: '', date: '', createdAt: '', updatedAt: '' },
  guests: { g1: mkGuest('g1', 'A', 'X'), g2: mkGuest('g2', 'B', 'Y') },
  groups: {},
  tables: {
    t1: {
      id: 't1',
      label: 'Table 1',
      designation: null,
      type: 'round',
      capacity: 8,
      x: 0,
      y: 0,
      rotation: 0,
      assignedGuestIds: [],
      seatMode: 'table',
      colour: null,
    },
  },
  zones: {},
  room: { width: 1200, height: 900, backgroundColour: '#FAF8F5' },
  canvas: { zoom: 1, panX: 0, panY: 0 },
  snapshots: [],
  constraints: [],
  settings: {
    defaultSeatMode: 'table',
    showDietaryBadges: true,
    showGroupColours: true,
    gridSnap: true,
    gridSize: 20,
  },
})

const s = () => useStore.getState()
const countTables = () => Object.keys(s().tables).length

beforeEach(() => {
  useStore.getState().hydrate(fixture())
})

describe('tables', () => {
  it('adds a table and supports undo / redo', () => {
    const cmd = s().addTable({ type: 'round', x: 10, y: 10 })
    expect(cmd.meta.newTableId).toBeTruthy()
    expect(countTables()).toBe(2)

    s().undo()
    expect(countTables()).toBe(1)
    s().redo()
    expect(countTables()).toBe(2)
  })

  it('deleting a table unassigns its guests, and undo restores both', () => {
    s().assignGuest('g1', 't1')
    expect(s().guests.g1.assignedTableId).toBe('t1')

    s().removeTable('t1')
    expect(s().tables.t1).toBeUndefined()
    expect(s().guests.g1.assignedTableId).toBeNull()

    s().undo()
    expect(s().tables.t1).toBeDefined()
    expect(s().guests.g1.assignedTableId).toBe('t1')
  })
})

describe('assignment', () => {
  it('assigns and unassigns a guest, keeping table + guest in sync', () => {
    s().assignGuest('g1', 't1')
    expect(s().tables.t1.assignedGuestIds).toContain('g1')

    s().undo()
    expect(s().guests.g1.assignedTableId).toBeNull()
    expect(s().tables.t1.assignedGuestIds).not.toContain('g1')
  })

  it('moving a guest to another table clears the original', () => {
    const t2 = s().addTable({ type: 'round', x: 5, y: 5 }).meta.newTableId
    s().assignGuest('g1', 't1')
    s().assignGuest('g1', t2)
    expect(s().tables.t1.assignedGuestIds).not.toContain('g1')
    expect(s().tables[t2].assignedGuestIds).toContain('g1')
  })
})

describe('guest field edits', () => {
  it('are undoable', () => {
    s().updateGuest('g1', { rsvpStatus: 'declined' })
    expect(s().guests.g1.rsvpStatus).toBe('declined')
    s().undo()
    expect(s().guests.g1.rsvpStatus).toBe('confirmed')
    s().redo()
    expect(s().guests.g1.rsvpStatus).toBe('declined')
  })

  it('keep fullName in sync, and undo restores the old one', () => {
    s().updateGuest('g1', { lastName: 'Z' })
    expect(s().guests.g1.fullName).toBe('A Z')
    s().undo()
    expect(s().guests.g1.fullName).toBe('A X')
  })
})

describe('plan details, settings and seating rules', () => {
  it('undoes a settings change without clobbering untouched keys', () => {
    s().updateSettings({ gridSize: 40 })
    expect(s().settings.gridSize).toBe(40)
    s().undo()
    expect(s().settings.gridSize).toBe(20)
    expect(s().settings.gridSnap).toBe(true)
  })

  it('ignores a no-op settings patch', () => {
    const before = s()._history.past.length
    s().updateSettings({ gridSize: s().settings.gridSize })
    expect(s()._history.past).toHaveLength(before)
  })

  it('undoes a wedding-name edit', () => {
    s().updateMeta({ weddingName: 'Renamed' })
    expect(s().meta.weddingName).toBe('Renamed')
    s().undo()
    expect(s().meta.weddingName).toBe('Test')
  })

  it('adds and removes a seating rule undoably', () => {
    const id = s().addConstraint({ kind: 'apart', guestIds: ['g1', 'g2'] }).meta.newConstraintId
    expect(s().constraints).toHaveLength(1)
    s().undo()
    expect(s().constraints).toHaveLength(0)
    s().redo()
    expect(s().constraints).toHaveLength(1)

    s().removeConstraint(id)
    expect(s().constraints).toHaveLength(0)
    s().undo()
    expect(s().constraints).toHaveLength(1)
  })
})

describe('history stack', () => {
  it('tracks past / future across undo and redo', () => {
    expect(s()._history.past).toHaveLength(0)
    s().addTable({ type: 'round', x: 0, y: 0 })
    expect(s()._history.past).toHaveLength(1)
    expect(s()._history.future).toHaveLength(0)
    s().undo()
    expect(s()._history.past).toHaveLength(0)
    expect(s()._history.future).toHaveLength(1)
  })
})

describe('groups', () => {
  it('creates a group and dissolves it via undo', () => {
    s().createGroup(['g1', 'g2'], { name: 'Family' })
    const gid = Object.keys(s().groups)[0]
    expect(s().guests.g1.groupId).toBe(gid)
    expect(s().guests.g2.groupId).toBe(gid)

    s().undo()
    expect(Object.keys(s().groups)).toHaveLength(0)
    expect(s().guests.g1.groupId).toBeNull()
  })
})

describe('import', () => {
  it('replace strategy resets the guest list', () => {
    s().importGuests(
      [{ firstName: 'New', lastName: 'Person', fullName: 'New Person', rsvpStatus: 'confirmed' }],
      'replace'
    )
    expect(Object.keys(s().guests)).toHaveLength(1)
    expect(Object.values(s().guests)[0].fullName).toBe('New Person')
  })

  it('is undoable and leaves earlier history intact', () => {
    s().addTable({ type: 'round', x: 3, y: 3 }) // a pre-import edit
    expect(countTables()).toBe(2)

    s().importGuests([{ firstName: 'New', lastName: 'Person' }], 'replace')
    expect(Object.keys(s().guests)).toHaveLength(1)

    s().undo() // undo the import itself
    expect(Object.keys(s().guests).sort()).toEqual(['g1', 'g2'])

    s().undo() // the pre-import edit is still on the stack
    expect(countTables()).toBe(1)
  })

  it('keeps grouping, tags and plus-ones when re-importing over a guest', () => {
    useStore.setState({
      guests: {
        ...s().guests,
        g1: {
          ...s().guests.g1,
          email: 'a@x.com',
          subgroupId: 'sg1',
          familyId: 'fam1',
          plusOneOf: 'g2',
          tags: ['top table'],
        },
      },
    })
    s().assignGuest('g1', 't1')

    s().importGuests(
      [{ firstName: 'A', lastName: 'X', fullName: 'A X', email: 'a@x.com', rsvpStatus: 'declined' }],
      'update'
    )

    const g1 = s().guests.g1
    expect(g1.rsvpStatus).toBe('declined') // the CSV still wins on its own fields
    expect(g1.subgroupId).toBe('sg1')
    expect(g1.familyId).toBe('fam1')
    expect(g1.plusOneOf).toBe('g2')
    expect(g1.tags).toEqual(['top table'])
    expect(g1.assignedTableId).toBe('t1')
  })

  it('refuses to guess between two existing guests sharing a name', () => {
    // Two "A X"s: an update import must not silently edit whichever the index
    // happened to write last.
    useStore.setState({
      guests: { ...s().guests, g2: { ...s().guests.g2, firstName: 'A', lastName: 'X', fullName: 'A X' } },
    })

    s().importGuests([{ firstName: 'A', lastName: 'X', fullName: 'A X', notes: 'from csv' }], 'update')

    expect(s().guests.g1.notes).toBe('')
    expect(s().guests.g2.notes).toBe('')
    expect(Object.keys(s().guests)).toHaveLength(3) // landed as a visible new row
  })

  it('does not let two incoming rows claim the same existing guest', () => {
    s().importGuests(
      [
        { firstName: 'A', lastName: 'X', fullName: 'A X', notes: 'first' },
        { firstName: 'A', lastName: 'X', fullName: 'A X', notes: 'second' },
      ],
      'update'
    )
    expect(s().guests.g1.notes).toBe('first')
    expect(Object.keys(s().guests)).toHaveLength(3)
  })

  it('restores seating and groups when a replace import is undone', () => {
    s().assignGuest('g1', 't1')
    s().createGroup(['g1', 'g2'], { name: 'Fam' })

    s().importGuests([{ firstName: 'New', lastName: 'Person' }], 'replace')
    expect(Object.keys(s().groups)).toHaveLength(0)
    expect(s().tables.t1.assignedGuestIds).toHaveLength(0)

    s().undo()
    expect(Object.keys(s().groups)).toHaveLength(1)
    expect(s().guests.g1.assignedTableId).toBe('t1')
    expect(s().tables.t1.assignedGuestIds).toContain('g1')
  })
})

describe('snapshots', () => {
  it('captures and restores a point-in-time copy', () => {
    s().addTable({ type: 'round', x: 1, y: 1 }) // now 2 tables
    const snap = s().saveSnapshot('checkpoint')
    expect(s().snapshots).toHaveLength(1)

    s().addTable({ type: 'round', x: 2, y: 2 }) // now 3 tables
    expect(countTables()).toBe(3)

    s().restoreSnapshot(snap.id)
    expect(countTables()).toBe(2)
    expect(s().snapshots).toHaveLength(1) // snapshot list preserved
  })
})
