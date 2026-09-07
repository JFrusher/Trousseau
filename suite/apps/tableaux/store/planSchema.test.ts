import { describe, expect, it } from 'vitest'
import { guestSchema, planDocSchema, tableSchema, validatePlanDoc } from './planSchema'

/**
 * The concrete regression test for the bug class the whole Tableaux typing
 * migration exists to prevent: a field of the wrong shape, or a renamed field,
 * used to be swallowed by `.passthrough()` and coerced to a default. It now
 * fails loudly.
 */

const guest = {
  id: 'g1',
  firstName: 'Charis',
  lastName: 'Frusher',
  fullName: 'Charis Frusher',
  email: '',
  dietary: '',
  dietaryRaw: '',
  side: null,
  rsvpStatus: 'confirmed',
  plusOneOf: null,
  groupId: null,
  familyId: null,
  assignedTableId: null,
  assignedSeatId: null,
  notes: '',
  tags: [],
}

const table = {
  id: 'tbl1',
  label: 'Table 1',
  designation: null,
  type: 'round',
  capacity: 8,
  x: 100,
  y: 200,
  rotation: 0,
  assignedGuestIds: [],
  seatMode: 'table',
  colour: null,
  perSideSeats: null,
  sizeUnits: { width: 10, height: 10 },
}

describe('guestSchema', () => {
  it('accepts a guest exactly as the store builds one', () => {
    expect(guestSchema.safeParse(guest).success).toBe(true)
  })

  it('keeps a field it has never heard of', () => {
    // Rule 2 of the envelope, one level down: an older build must not destroy
    // a field a newer one added.
    const parsed = guestSchema.parse({ ...guest, favouriteColour: 'sage' })
    expect(parsed).toMatchObject({ favouriteColour: 'sage' })
  })

  it('rejects a guest with no id rather than defaulting one', () => {
    const { id: _dropped, ...noId } = guest
    expect(guestSchema.safeParse(noId).success).toBe(false)
  })

  it('rejects a renamed field instead of silently coercing it', () => {
    // `firstname` is not `firstName`. This is exactly the failure the audit
    // found: the old schema took it as a passthrough key and defaulted the
    // real one.
    const { firstName: _dropped, ...renamed } = guest
    expect(guestSchema.safeParse({ ...renamed, firstname: 'Charis' }).success).toBe(false)
  })

  it('rejects a field of the wrong type', () => {
    expect(guestSchema.safeParse({ ...guest, tags: 'not an array' }).success).toBe(false)
  })
})

describe('tableSchema', () => {
  it('accepts a table exactly as the store builds one', () => {
    expect(tableSchema.safeParse(table).success).toBe(true)
  })

  it('rejects a table whose position is not a number', () => {
    expect(tableSchema.safeParse({ ...table, x: '100' }).success).toBe(false)
  })

  it('accepts a null in the seat array, which means an empty seat', () => {
    // Not a missing id: `assignedGuestIds` is seat-indexed for seat-level
    // tables, and `normaliseSeats` in actions.js documents it as
    // `(string|null)[]`. The first draft of this schema said `z.string()` and
    // persistRoundtrip.test.js caught it immediately.
    expect(tableSchema.safeParse({ ...table, assignedGuestIds: ['g1', null, 'g2'] }).success).toBe(
      true,
    )
  })

  it('still rejects a seat array holding something that is neither', () => {
    expect(tableSchema.safeParse({ ...table, assignedGuestIds: ['g1', 42] }).success).toBe(false)
  })

  it('rejects a table with no capacity rather than defaulting one', () => {
    const { capacity: _dropped, ...noCapacity } = table
    expect(tableSchema.safeParse(noCapacity).success).toBe(false)
  })
})

describe('planDocSchema', () => {
  it('accepts a whole document built from the store shapes', () => {
    const doc = { guests: { g1: guest }, tables: { tbl1: table } }
    expect(planDocSchema.safeParse(doc).success).toBe(true)
  })

  it('rejects a document whose guest is malformed, naming the guest map', () => {
    const doc = { guests: { g1: { ...guest, tags: 'not an array' } } }
    expect(planDocSchema.safeParse(doc).success).toBe(false)
  })

  it('still carries a slice belonging to nothing it knows about', () => {
    const doc = { guests: {}, somethingNobodyHasWrittenYet: { a: 1 } }
    expect(planDocSchema.parse(doc)).toMatchObject({ somethingNobodyHasWrittenYet: { a: 1 } })
  })

  it('validatePlanDoc throws a 400-tagged error on a malformed guest', () => {
    // The tagged error is vestigial but is still what this throws.
    expect(() => validatePlanDoc({ guests: { g1: { ...guest, tags: 5 } } })).toThrow()
    try {
      validatePlanDoc({ guests: { g1: { ...guest, tags: 5 } } })
    } catch (error) {
      expect((error as { status?: number }).status).toBe(400)
    }
  })
})
