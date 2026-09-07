/**
 * The shape a saved plan is allowed to have.
 *
 * This lived on Tableaux's server, where it was the last check before a
 * document reached the database. There is no server now, but the schema was
 * never really about the network: it is the definition of a valid plan, and the
 * store's round-trip tests are written against it. Moved rather than dropped,
 * because deleting it would have meant deleting the tests that use it — which
 * is how a document format quietly stops being enforced.
 */
import { z } from 'zod'

// Hard caps to stop a malicious or buggy client from persisting an unbounded
// document. The client owns the rich per-entity shape; the server enforces
// types and ceilings so a save can't become a storage-abuse vector.
export const LIMITS = {
  guests: 5000,
  tables: 1000,
  zones: 500,
  groups: 1000,
  constraints: 5000,
  snapshots: 50,
}

/**
 * The real shapes, taken from the store's own factories (`addGuest` and
 * `addTable` in `actions.js`, and the initial `room` in `useStore.js`) so that
 * a document the live store produces validates by construction.
 *
 * Every object is loose, never strict: a field a later Tableaux build adds has
 * to survive an older build round-tripping the document, which is the
 * envelope's rule-2 one level down.
 *
 * Identity and structural fields are required on purpose. An optional field
 * catches nothing — the bug this schema exists to prevent is a *renamed* field
 * being swallowed as a passthrough key while the real one quietly defaults,
 * and only a required field turns that into a failure.
 */
export const guestSchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    fullName: z.string(),
    email: z.string().optional(),
    dietary: z.string().optional(),
    dietaryRaw: z.string().optional(),
    side: z.string().nullable().optional(),
    rsvpStatus: z.string().optional(),
    plusOneOf: z.string().nullable().optional(),
    groupId: z.string().nullable().optional(),
    familyId: z.string().nullable().optional(),
    assignedTableId: z.string().nullable().optional(),
    assignedSeatId: z.string().nullable().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough()

export const tableSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    type: z.string(),
    capacity: z.number(),
    x: z.number(),
    y: z.number(),
    rotation: z.number().optional(),
    designation: z.string().nullable().optional(),
    /**
     * Seat-indexed for seat-level tables, so a `null` is an empty seat rather
     * than a missing id — see `normaliseSeats` in `actions.js`, whose own
     * JSDoc says `(string|null)[]`. The round-trip test caught this the first
     * time the schema was stricter than `.passthrough()`.
     */
    assignedGuestIds: z.array(z.string().nullable()).optional(),
    seatMode: z.string().optional(),
    colour: z.string().nullable().optional(),
    perSideSeats: z.unknown().optional(),
    sizeUnits: z.unknown().optional(),
  })
  .passthrough()

export const roomSchema = z
  .object({
    widthUnits: z.number().optional(),
    heightUnits: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    backgroundColour: z.string().optional(),
  })
  .passthrough()

export type Guest = z.infer<typeof guestSchema>
export type TableEntity = z.infer<typeof tableSchema>
export type Room = z.infer<typeof roomSchema>

// Generic rather than a bare `z.ZodType` parameter so the element type survives
// into `PlanDoc`. Note `z.ZodTypeAny` does NOT exist in zod 4 — it was removed,
// and using it is a compile error.
const entityMap = <T extends z.ZodType>(schema: T, max: number, label: string) =>
  z
    .record(z.string(), schema)
    .refine((m) => Object.keys(m).length <= max, { message: `Too many ${label} (max ${max})` })

/** Still loose for the collections nothing has typed yet. */
const looseMap = (max: number, label: string) => entityMap(z.object({}).passthrough(), max, label)

export const planDocSchema = z
  .object({
    meta: z.object({}).passthrough().optional(),
    guests: entityMap(guestSchema, LIMITS.guests, 'guests').optional(),
    groups: looseMap(LIMITS.groups, 'groups').optional(),
    tables: entityMap(tableSchema, LIMITS.tables, 'tables').optional(),
    zones: looseMap(LIMITS.zones, 'zones').optional(),
    room: roomSchema.optional(),
    canvas: z.object({}).passthrough().optional(),
    constraints: z.array(z.object({}).passthrough()).max(LIMITS.constraints).optional(),
    settings: z.object({}).passthrough().optional(),
    snapshots: z.array(z.object({}).passthrough()).max(LIMITS.snapshots).optional(),
  })
  .passthrough()

export type PlanDoc = z.infer<typeof planDocSchema>

// Absolute serialized-size ceiling: stops a few entities with huge string fields
// from bloating storage even when entity counts are within their caps.
export const MAX_DOC_BYTES = 8 * 1024 * 1024

/**
 * An error carrying the HTTP status the old Express server would have sent.
 *
 * Nothing reads `status` any more — there is no server — but it is part of
 * what this function throws today, and this pass changes no behaviour. Typed
 * rather than dropped.
 */
class PlanDocError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'PlanDocError'
    this.status = status
  }
}

/** Validate an incoming plan document. Throws a 400-tagged error on failure. */
export function validatePlanDoc(doc: unknown) {
  const parsed = planDocSchema.safeParse(doc)
  if (!parsed.success) {
    const msg = parsed.error.issues?.[0]?.message || 'Invalid plan document'
    throw new PlanDocError(msg)
  }
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data))
  if (bytes > MAX_DOC_BYTES) {
    throw new PlanDocError('Plan document is too large')
  }
  return parsed.data
}
