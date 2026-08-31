/**
 * Action creators. Each returns a *thunk* `(state) => command`, where command
 * is `{ type, label, payload, inverse }`. The inverse is captured from the
 * current state at dispatch time, so undo is always exact.
 *
 * Components dispatch via the bound helpers on the store (e.g. `moveTable(id,
 * x, y)`), which call `dispatch(creator(...args))`. Returning `null` from a
 * thunk is a no-op (e.g. assigning a guest that doesn't exist).
 *
 * Only mutations in the brief's undoable list live here. Ephemeral UI state
 * (selection, search, pan/zoom) and free-text inspector edits are plain store
 * setters and intentionally bypass history.
 */
import { makeId, seatId } from '../utils/ids.js'
import {
  getTableType,
  clampCapacity,
  clampPerSide,
  seatCountFromPerSide,
} from '../utils/tableTypes.js'
import { deriveSizeUnits, DEFAULT_PPU } from '../utils/seatPositions.js'

// ── array helpers ───────────────────────────────────────────────────────────

const withoutGuest = (arr = [], guestId, seatMode) =>
  seatMode === 'seat'
    ? arr.map((id) => (id === guestId ? null : id))
    : arr.filter((id) => id && id !== guestId)

const withoutMembers = (arr = [], memberSet, seatMode) =>
  seatMode === 'seat'
    ? arr.map((id) => (memberSet.has(id) ? null : id))
    : arr.filter((id) => id && !memberSet.has(id))

const normaliseSeats = (arr = [], capacity) => {
  const out = new Array(capacity).fill(null)
  const overflow = []
  arr.forEach((id, i) => {
    if (i < capacity) out[i] = id ?? null
    else if (id) overflow.push(id)
  })
  return overflow.length ? [...out, ...overflow] : out
}

/**
 * Seat a block of guests (family/subgroup/group) at a table as one unit.
 *
 * Table-mode tables have no seat identity, so members are appended.
 * Seat-mode tables keep their empty slots — members take a contiguous run of
 * free seats (wrapping past the last seat, since seats circle the table) so a
 * family reads as one cluster and nobody already seated gets shifted.
 *
 * `anchor` pins the run's first seat (a drop onto a specific SeatSlot).
 * Returns null when no run fits — callers must treat that as a refused drop.
 *
 * @returns {{ assignedGuestIds: (string|null)[], indices: number[]|null }|null}
 */
export const placeMembers = (arr = [], capacity, seatMode, memberIds, anchor = null) => {
  if (seatMode !== 'seat') {
    return { assignedGuestIds: [...arr.filter(Boolean), ...memberIds], indices: null }
  }
  const seats = normaliseSeats(arr, capacity)
  const n = memberIds.length
  if (n > capacity) return null

  const runFrom = (start) => {
    const idx = []
    for (let i = 0; i < n; i++) {
      const s = (start + i) % capacity
      if (seats[s]) return null
      idx.push(s)
    }
    return idx
  }

  let indices = null
  if (anchor != null) {
    indices = runFrom(((anchor % capacity) + capacity) % capacity)
  } else {
    for (let start = 0; start < capacity && !indices; start++) indices = runFrom(start)
  }
  if (!indices) return null

  indices.forEach((s, i) => {
    seats[s] = memberIds[i]
  })
  return { assignedGuestIds: seats, indices }
}

const nextTableLabel = (state) => {
  let max = 0
  let count = 0
  for (const t of Object.values(state.tables)) {
    count++
    const m = /^Table\s+(\d+)$/i.exec(t.label || '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `Table ${Math.max(max, count) + 1}`
}

// ── tables ──────────────────────────────────────────────────────────────────

export const addTable =
  ({ type = 'round', x = 0, y = 0, label, capacity, sizeUnits, perSideSeats, seatMode }) =>
  (state) => {
    const def = getTableType(type)
    const ppu = state.settings?.pixelsPerUnit || DEFAULT_PPU
    const base = {
      id: makeId('tbl'),
      label: label || nextTableLabel(state),
      designation: null,
      type,
      capacity: capacity ?? def.defaultCapacity,
      x: Math.round(x),
      y: Math.round(y),
      rotation: 0,
      assignedGuestIds: [],
      seatMode: seatMode || state.settings?.defaultSeatMode || 'table',
      colour: null,
      perSideSeats: perSideSeats || null,
    }
    // A preset supplies an explicit footprint/seating; a bare type derives the
    // default footprint from the preset + capacity (legacy behaviour).
    const table = { ...base, sizeUnits: sizeUnits || deriveSizeUnits(base, ppu) }
    return {
      type: 'ADD_TABLE',
      label: 'Add table',
      payload: { tables: { [table.id]: table } },
      inverse: { tables: { [table.id]: null } },
      meta: { newTableId: table.id },
    }
  }

export const removeTable = (id) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  const guestIds = (table.assignedGuestIds || []).filter(Boolean)
  const guestsForward = {}
  const guestsInverse = {}
  guestIds.forEach((gid) => {
    const g = state.guests[gid]
    if (!g) return
    guestsForward[gid] = { ...g, assignedTableId: null, assignedSeatId: null }
    guestsInverse[gid] = g
  })
  return {
    type: 'DELETE_TABLE',
    label: 'Delete table',
    payload: { tables: { [id]: null }, guests: guestsForward },
    inverse: { tables: { [id]: table }, guests: guestsInverse },
  }
}

export const duplicateTable = (id) => (state) => {
  const src = state.tables[id]
  if (!src) return null
  const copy = {
    ...src,
    id: makeId('tbl'),
    label: `${src.label} copy`,
    x: src.x + 32,
    y: src.y + 32,
    assignedGuestIds: [],
  }
  return {
    type: 'ADD_TABLE',
    label: 'Duplicate table',
    payload: { tables: { [copy.id]: copy } },
    inverse: { tables: { [copy.id]: null } },
    meta: { newTableId: copy.id },
  }
}

export const moveTable = (id, x, y) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  return {
    type: 'MOVE_TABLE',
    label: 'Move table',
    payload: { tables: { [id]: { ...table, x: Math.round(x), y: Math.round(y) } } },
    inverse: { tables: { [id]: table } },
  }
}

export const renameTable = (id, label) => (state) => {
  const table = state.tables[id]
  if (!table || table.label === label) return null
  return {
    type: 'RENAME_TABLE',
    label: 'Rename table',
    payload: { tables: { [id]: { ...table, label } } },
    inverse: { tables: { [id]: table } },
  }
}

export const changeCapacity = (id, capacity) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  const next = clampCapacity(table.type, capacity)
  if (next === table.capacity) return null
  return {
    type: 'CHANGE_CAPACITY',
    label: 'Change capacity',
    payload: { tables: { [id]: { ...table, capacity: next } } },
    inverse: { tables: { [id]: table } },
  }
}

export const changeTableType = (id, type) => (state) => {
  const table = state.tables[id]
  if (!table || table.type === type) return null
  const capacity = clampCapacity(type, table.capacity)
  // Switching to a preset shape drops any custom per-side seating and resets
  // the footprint to that type's defaults, so geometry matches the new shape.
  const ppu = state.settings?.pixelsPerUnit || DEFAULT_PPU
  const base = { ...table, type, capacity, perSideSeats: null, custom: false }
  const next = { ...base, sizeUnits: deriveSizeUnits(base, ppu) }
  return {
    type: 'CHANGE_TYPE',
    label: 'Change table type',
    payload: { tables: { [id]: next } },
    inverse: { tables: { [id]: table } },
  }
}

// Set independent seat counts per edge for a (custom) rectangle. Capacity is
// derived from the sum, and seat-level arrays are renormalised to the new size.
export const setPerSideSeats = (id, perSide) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  const clean = clampPerSide(perSide)
  const capacity = Math.max(1, seatCountFromPerSide(clean))
  let assignedGuestIds = table.assignedGuestIds || []
  if (table.seatMode === 'seat') {
    assignedGuestIds = normaliseSeats(assignedGuestIds, capacity)
  }
  return {
    type: 'SET_PER_SIDE_SEATS',
    label: 'Set seats per side',
    payload: { tables: { [id]: { ...table, perSideSeats: clean, capacity, assignedGuestIds } } },
    inverse: { tables: { [id]: table } },
  }
}

// Create a rectangle/square table with per-edge seat counts (the custom builder).
export const createCustomTable =
  ({ x = 0, y = 0, width = 200, height = 120, perSideSeats, label, seatMode } = {}) =>
  (state) => {
    const clean = clampPerSide(perSideSeats || { top: 4, right: 0, bottom: 4, left: 0 })
    const capacity = Math.max(1, seatCountFromPerSide(clean))
    const id = makeId('tbl')
    const table = {
      id,
      label: label || nextTableLabel(state),
      designation: null,
      type: 'rect',
      custom: true,
      capacity,
      x: Math.round(x),
      y: Math.round(y),
      rotation: 0,
      assignedGuestIds: [],
      seatMode: seatMode || state.settings?.defaultSeatMode || 'table',
      colour: null,
      perSideSeats: clean,
      sizeUnits: { shape: 'rect', width: Math.round(width), height: Math.round(height) },
    }
    return {
      type: 'ADD_TABLE',
      label: 'Add custom table',
      payload: { tables: { [id]: table } },
      inverse: { tables: { [id]: null } },
      meta: { newTableId: id },
    }
  }

export const setDesignation = (id, designation) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  return {
    type: 'SET_DESIGNATION',
    label: 'Set designation',
    payload: { tables: { [id]: { ...table, designation } } },
    inverse: { tables: { [id]: table } },
  }
}

export const setTableColour = (id, colour) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  return {
    type: 'SET_TABLE_COLOUR',
    label: 'Recolour table',
    payload: { tables: { [id]: { ...table, colour } } },
    inverse: { tables: { [id]: table } },
  }
}

export const rotateTable = (id, rotation) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  return {
    type: 'ROTATE_TABLE',
    label: 'Rotate table',
    payload: { tables: { [id]: { ...table, rotation } } },
    inverse: { tables: { [id]: table } },
  }
}

// Set the canvas scale (px per cm). Undoable so an accidental calibration can
// be reversed — every table/room/chair re-derives its pixels from this.
export const calibrate = (pixelsPerUnit) => (state) => {
  const prev = state.settings.pixelsPerUnit
  if (!pixelsPerUnit || pixelsPerUnit === prev) return null
  return {
    type: 'CALIBRATE',
    label: 'Calibrate scale',
    payload: { settings: { pixelsPerUnit } },
    inverse: { settings: { pixelsPerUnit: prev } },
  }
}

// Resize the room in real-world units. Stores cm (authoritative) plus derived
// px so legacy readers stay in sync.
export const setRoomSizeUnits = (widthUnits, heightUnits) => (state) => {
  const room = state.room
  const ppu = state.settings?.pixelsPerUnit || 0.7
  const next = {
    ...room,
    widthUnits: Math.round(widthUnits),
    heightUnits: Math.round(heightUnits),
    width: Math.round(widthUnits * ppu),
    height: Math.round(heightUnits * ppu),
  }
  return {
    type: 'RESIZE_ROOM',
    label: 'Resize room',
    payload: { room: next },
    inverse: { room },
  }
}

// ── table presets (venue defaults) ──────────────────────────────────────────
// A preset stores a table's footprint AND seating ("chairings") so it can be
// dropped from the palette to recreate the same table. Stored on settings so it
// persists with the plan; undoable like any settings change.

export const saveTablePreset = (id, name) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  const presets = state.settings.customTablePresets || []
  const preset = {
    id: makeId('preset'),
    name: (name || '').trim() || table.label || 'Preset',
    type: table.type,
    sizeUnits: table.sizeUnits || null,
    capacity: table.capacity,
    perSideSeats: table.perSideSeats || null,
    seatMode: table.seatMode || 'table',
  }
  return {
    type: 'SAVE_TABLE_PRESET',
    label: 'Save table preset',
    payload: { settings: { customTablePresets: [...presets, preset] } },
    inverse: { settings: { customTablePresets: presets } },
  }
}

export const deleteTablePreset = (presetId) => (state) => {
  const presets = state.settings.customTablePresets || []
  if (!presets.some((p) => p.id === presetId)) return null
  return {
    type: 'DELETE_TABLE_PRESET',
    label: 'Delete table preset',
    payload: { settings: { customTablePresets: presets.filter((p) => p.id !== presetId) } },
    inverse: { settings: { customTablePresets: presets } },
  }
}

export const resizeTable = (id, sizeUnits) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  const next = { ...(table.sizeUnits || {}), ...sizeUnits }
  return {
    type: 'RESIZE_TABLE',
    label: 'Resize table',
    payload: { tables: { [id]: { ...table, sizeUnits: next } } },
    inverse: { tables: { [id]: table } },
  }
}

export const setSeatMode = (id, mode) => (state) => {
  const table = state.tables[id]
  if (!table || table.seatMode === mode) return null
  let assignedGuestIds = table.assignedGuestIds || []
  if (mode === 'seat') {
    assignedGuestIds = normaliseSeats(assignedGuestIds.filter(Boolean), table.capacity)
  } else {
    assignedGuestIds = assignedGuestIds.filter(Boolean)
  }
  return {
    type: 'SET_SEAT_MODE',
    label: 'Toggle seat mode',
    payload: { tables: { [id]: { ...table, seatMode: mode, assignedGuestIds } } },
    inverse: { tables: { [id]: table } },
  }
}

export const clearTable = (id) => (state) => {
  const table = state.tables[id]
  if (!table) return null
  const guestIds = (table.assignedGuestIds || []).filter(Boolean)
  if (!guestIds.length) return null
  const guestsForward = {}
  const guestsInverse = {}
  guestIds.forEach((gid) => {
    const g = state.guests[gid]
    if (!g) return
    guestsForward[gid] = { ...g, assignedTableId: null, assignedSeatId: null }
    guestsInverse[gid] = g
  })
  return {
    type: 'CLEAR_TABLE',
    label: 'Clear table',
    payload: {
      tables: { [id]: { ...table, assignedGuestIds: [] } },
      guests: guestsForward,
    },
    inverse: { tables: { [id]: table }, guests: guestsInverse },
  }
}

// ── guests ──────────────────────────────────────────────────────────────────

// Create a single guest manually (e.g. a late RSVP) without re-importing a CSV.
export const addGuest = (partial = {}) => () => {
  const first = (partial.firstName || '').trim()
  const last = (partial.lastName || '').trim()
  const fullName = (partial.fullName || `${first} ${last}`).trim() || 'New guest'
  const id = makeId('g')
  const guest = {
    id,
    firstName: first,
    lastName: last,
    fullName,
    email: (partial.email || '').trim(),
    dietary: partial.dietary || '',
    dietaryRaw: partial.dietaryRaw || partial.dietary || '',
    side: partial.side ?? null,
    rsvpStatus: partial.rsvpStatus || 'confirmed',
    plusOneOf: partial.plusOneOf ?? null,
    groupId: partial.groupId ?? null,
    familyId: null,
    assignedTableId: null,
    assignedSeatId: null,
    notes: (partial.notes || '').trim(),
    tags: Array.isArray(partial.tags) ? partial.tags : [],
  }
  return {
    type: 'ADD_GUEST',
    label: 'Add guest',
    payload: { guests: { [id]: guest } },
    inverse: { guests: { [id]: null } },
    meta: { newGuestId: id },
  }
}

// Edit a guest's own fields (name, email, side, RSVP, dietary, notes, tags).
// Group/subgroup/family membership and seating are NOT edited here — those have
// their own commands, since they patch several collections at once.
export const updateGuest = (id, patch) => (state) => {
  const guest = state.guests[id]
  if (!guest) return null
  const next = { ...guest, ...patch }
  next.fullName =
    patch.fullName || `${next.firstName} ${next.lastName}`.trim() || next.fullName
  return {
    type: 'UPDATE_GUEST',
    label: 'Edit guest',
    payload: { guests: { [id]: next } },
    inverse: { guests: { [id]: guest } },
  }
}

// Build the forward/inverse patches to remove a set of guests: deletes the
// guests, unseats them from any table, drops them from their group, and detaches
// any plus-ones that referenced them.
const buildRemoval = (state, idSet) => {
  const guestsForward = {}
  const guestsInverse = {}
  const tablesForward = {}
  const tablesInverse = {}
  const groupsForward = {}
  const groupsInverse = {}
  const subgroupsForward = {}
  const subgroupsInverse = {}
  const familiesForward = {}
  const familiesInverse = {}

  idSet.forEach((id) => {
    guestsForward[id] = null
    guestsInverse[id] = state.guests[id]
  })
  Object.values(state.tables).forEach((t) => {
    const arr = t.assignedGuestIds || []
    if (arr.some((gid) => idSet.has(gid))) {
      tablesInverse[t.id] = t
      tablesForward[t.id] = { ...t, assignedGuestIds: withoutMembers(arr, idSet, t.seatMode) }
    }
  })
  Object.values(state.groups).forEach((gr) => {
    const arr = gr.memberIds || []
    if (arr.some((gid) => idSet.has(gid))) {
      groupsInverse[gr.id] = gr
      groupsForward[gr.id] = { ...gr, memberIds: arr.filter((gid) => !idSet.has(gid)) }
    }
  })
  Object.values(state.subgroups || {}).forEach((sg) => {
    const arr = sg.memberIds || []
    if (arr.some((gid) => idSet.has(gid))) {
      subgroupsInverse[sg.id] = sg
      subgroupsForward[sg.id] = { ...sg, memberIds: arr.filter((gid) => !idSet.has(gid)) }
    }
  })
  Object.values(state.families || {}).forEach((f) => {
    const arr = f.memberIds || []
    if (arr.some((gid) => idSet.has(gid))) {
      familiesInverse[f.id] = f
      familiesForward[f.id] = { ...f, memberIds: arr.filter((gid) => !idSet.has(gid)) }
    }
  })
  Object.values(state.guests).forEach((other) => {
    if (!idSet.has(other.id) && other.plusOneOf && idSet.has(other.plusOneOf)) {
      guestsInverse[other.id] = other
      guestsForward[other.id] = { ...other, plusOneOf: null }
    }
  })
  return {
    payload: {
      guests: guestsForward,
      tables: tablesForward,
      groups: groupsForward,
      subgroups: subgroupsForward,
      families: familiesForward,
    },
    inverse: {
      guests: guestsInverse,
      tables: tablesInverse,
      groups: groupsInverse,
      subgroups: subgroupsInverse,
      families: familiesInverse,
    },
  }
}

export const removeGuest = (guestId) => (state) => {
  if (!state.guests[guestId]) return null
  const { payload, inverse } = buildRemoval(state, new Set([guestId]))
  return { type: 'DELETE_GUEST', label: 'Delete guest', payload, inverse }
}

export const removeGuests = (ids) => (state) => {
  const idSet = new Set((ids || []).filter((id) => state.guests[id]))
  if (!idSet.size) return null
  const { payload, inverse } = buildRemoval(state, idSet)
  return { type: 'DELETE_GUESTS', label: `Delete ${idSet.size} guests`, payload, inverse }
}

// ── assignment ────────────────────────────────────────────────────────────

export const assignGuest =
  (guestId, tableId, seatIndex = null) =>
  (state) => {
    const guest = state.guests[guestId]
    const target = state.tables[tableId]
    if (!guest || !target) return null

    const prevTableId = guest.assignedTableId
    const affected = new Set([tableId])
    if (prevTableId) affected.add(prevTableId)

    const inverseGuests = { [guestId]: guest }
    const inverseTables = {}
    affected.forEach((tid) => {
      inverseTables[tid] = state.tables[tid]
    })

    const working = {}
    affected.forEach((tid) => {
      working[tid] = [...(state.tables[tid].assignedGuestIds || [])]
    })
    if (prevTableId) {
      working[prevTableId] = withoutGuest(
        working[prevTableId],
        guestId,
        state.tables[prevTableId].seatMode
      )
    }

    const forwardGuests = {}
    if (target.seatMode === 'seat' && seatIndex != null) {
      const arr = normaliseSeats(
        withoutGuest(working[tableId], guestId, 'seat'),
        target.capacity
      )
      const occupant = arr[seatIndex]
      if (occupant && occupant !== guestId) {
        forwardGuests[occupant] = {
          ...state.guests[occupant],
          assignedTableId: null,
          assignedSeatId: null,
        }
        inverseGuests[occupant] = state.guests[occupant]
      }
      arr[seatIndex] = guestId
      working[tableId] = arr
      forwardGuests[guestId] = {
        ...guest,
        assignedTableId: tableId,
        assignedSeatId: seatId(tableId, seatIndex),
      }
    } else {
      const arr = working[tableId].filter((id) => id && id !== guestId)
      arr.push(guestId)
      working[tableId] = arr
      forwardGuests[guestId] = { ...guest, assignedTableId: tableId, assignedSeatId: null }
    }

    const forwardTables = {}
    affected.forEach((tid) => {
      forwardTables[tid] = { ...state.tables[tid], assignedGuestIds: working[tid] }
    })

    return {
      type: 'ASSIGN_GUEST',
      label: 'Assign guest',
      payload: { guests: forwardGuests, tables: forwardTables },
      inverse: { guests: inverseGuests, tables: inverseTables },
    }
  }

// Swap two seated guests within the same seat-level table (or move one into an
// empty seat in the pair). Drag a seated guest onto an occupied seat to swap.
export const swapSeatGuests = (tableId, indexA, indexB) => (state) => {
  const table = state.tables[tableId]
  if (!table || table.seatMode !== 'seat' || indexA === indexB) return null

  const arr = normaliseSeats(table.assignedGuestIds || [], table.capacity)
  if (indexA < 0 || indexB < 0 || indexA >= arr.length || indexB >= arr.length) return null

  const a = arr[indexA] ?? null
  const b = arr[indexB] ?? null
  if (!a && !b) return null

  const next = [...arr]
  next[indexA] = b
  next[indexB] = a

  const guestsForward = {}
  const guestsInverse = {}
  if (a && state.guests[a]) {
    guestsInverse[a] = state.guests[a]
    guestsForward[a] = { ...state.guests[a], assignedTableId: tableId, assignedSeatId: seatId(tableId, indexB) }
  }
  if (b && state.guests[b]) {
    guestsInverse[b] = state.guests[b]
    guestsForward[b] = { ...state.guests[b], assignedTableId: tableId, assignedSeatId: seatId(tableId, indexA) }
  }

  return {
    type: 'SWAP_SEATS',
    label: 'Swap seats',
    payload: { tables: { [tableId]: { ...table, assignedGuestIds: next } }, guests: guestsForward },
    inverse: { tables: { [tableId]: table }, guests: guestsInverse },
  }
}

export const unassignGuest = (guestId) => (state) => {
  const guest = state.guests[guestId]
  if (!guest || !guest.assignedTableId) return null
  const tid = guest.assignedTableId
  const table = state.tables[tid]
  return {
    type: 'UNASSIGN_GUEST',
    label: 'Unassign guest',
    payload: {
      guests: { [guestId]: { ...guest, assignedTableId: null, assignedSeatId: null } },
      tables: table
        ? {
            [tid]: {
              ...table,
              assignedGuestIds: withoutGuest(table.assignedGuestIds, guestId, table.seatMode),
            },
          }
        : {},
    },
    inverse: {
      guests: { [guestId]: guest },
      ...(table ? { tables: { [tid]: table } } : {}),
    },
  }
}

export const assignGroupToTable = (groupId, tableId) => (state) => {
  const group = state.groups[groupId]
  const target = state.tables[tableId]
  if (!group || !target) return null
  const memberIds = (group.memberIds || []).filter((id) => state.guests[id])
  if (!memberIds.length) return null

  const affected = new Set([tableId])
  memberIds.forEach((gid) => {
    const t = state.guests[gid].assignedTableId
    if (t) affected.add(t)
  })

  const inverseGuests = {}
  const inverseTables = {}
  memberIds.forEach((gid) => {
    inverseGuests[gid] = state.guests[gid]
  })
  affected.forEach((tid) => {
    inverseTables[tid] = state.tables[tid]
  })

  const memberSet = new Set(memberIds)
  const working = {}
  affected.forEach((tid) => {
    working[tid] = withoutMembers(
      [...(state.tables[tid].assignedGuestIds || [])],
      memberSet,
      state.tables[tid].seatMode
    )
  })
  const placed = placeMembers(working[tableId], target.capacity, target.seatMode, memberIds)
  if (!placed) return null
  working[tableId] = placed.assignedGuestIds

  const forwardGuests = {}
  memberIds.forEach((gid, i) => {
    forwardGuests[gid] = {
      ...state.guests[gid],
      assignedTableId: tableId,
      assignedSeatId: placed.indices ? seatId(tableId, placed.indices[i]) : null,
    }
  })
  const forwardTables = {}
  affected.forEach((tid) => {
    forwardTables[tid] = { ...state.tables[tid], assignedGuestIds: working[tid] }
  })

  return {
    type: 'ASSIGN_GROUP',
    label: 'Seat group',
    payload: { guests: forwardGuests, tables: forwardTables },
    inverse: { guests: inverseGuests, tables: inverseTables },
  }
}

// ── groups ──────────────────────────────────────────────────────────────────

const GROUP_COLOURS = [
  '#7B6FA0',
  '#4A7C59',
  '#C07C2A',
  '#5C7E9E',
  '#A6576A',
  '#7C6F5B',
  '#5E8A7C',
  '#9E6B4A',
]

export const createGroup =
  (memberIds, { name, colour } = {}) =>
  (state) => {
    const ids = (memberIds || []).filter((id) => state.guests[id])
    if (!ids.length) return null
    const group = {
      id: makeId('grp'),
      name: name || 'New group',
      colour: colour || GROUP_COLOURS[Object.keys(state.groups).length % GROUP_COLOURS.length],
      memberIds: ids,
    }
    const guestsForward = {}
    const guestsInverse = {}
    ids.forEach((gid) => {
      guestsInverse[gid] = state.guests[gid]
      guestsForward[gid] = { ...state.guests[gid], groupId: group.id }
    })
    return {
      type: 'CREATE_GROUP',
      label: 'Create group',
      payload: { groups: { [group.id]: group }, guests: guestsForward },
      inverse: { groups: { [group.id]: null }, guests: guestsInverse },
      meta: { newGroupId: group.id },
    }
  }

// Create an empty group (no members yet) — for the "+ New group" entry point,
// after which guests are added via drag or the inspector. createGroup requires
// at least one member; this one intentionally does not.
export const createEmptyGroup =
  ({ name, colour } = {}) =>
  (state) => {
    const group = {
      id: makeId('grp'),
      name: name || 'New group',
      colour: colour || GROUP_COLOURS[Object.keys(state.groups).length % GROUP_COLOURS.length],
      memberIds: [],
    }
    return {
      type: 'CREATE_EMPTY_GROUP',
      label: 'Create group',
      payload: { groups: { [group.id]: group } },
      inverse: { groups: { [group.id]: null } },
      meta: { newGroupId: group.id },
    }
  }

export const dissolveGroup = (groupId) => (state) => {
  const group = state.groups[groupId]
  if (!group) return null
  // Also dissolve all subgroups belonging to this group
  const ownSubgroups = Object.values(state.subgroups || {}).filter(
    (sg) => sg.parentGroupId === groupId
  )
  const subgroupsForward = {}
  const subgroupsInverse = {}
  ownSubgroups.forEach((sg) => {
    subgroupsInverse[sg.id] = sg
    subgroupsForward[sg.id] = null
  })
  // Also dissolve all families attached to this group, directly or via one of its subgroups
  const ownSubgroupIds = new Set(ownSubgroups.map((sg) => sg.id))
  const ownFamilies = Object.values(state.families || {}).filter(
    (f) => f.parentGroupId === groupId || ownSubgroupIds.has(f.parentSubgroupId)
  )
  const familiesForward = {}
  const familiesInverse = {}
  ownFamilies.forEach((f) => {
    familiesInverse[f.id] = f
    familiesForward[f.id] = null
  })
  const guestsForward = {}
  const guestsInverse = {}
  ;(group.memberIds || []).forEach((gid) => {
    const g = state.guests[gid]
    if (!g) return
    guestsInverse[gid] = g
    guestsForward[gid] = { ...g, groupId: null, subgroupId: null, familyId: null }
  })
  return {
    type: 'DISSOLVE_GROUP',
    label: 'Dissolve group',
    payload: {
      groups: { [groupId]: null },
      subgroups: subgroupsForward,
      families: familiesForward,
      guests: guestsForward,
    },
    inverse: {
      groups: { [groupId]: group },
      subgroups: subgroupsInverse,
      families: familiesInverse,
      guests: guestsInverse,
    },
  }
}

export const renameGroup = (groupId, name) => (state) => {
  const group = state.groups[groupId]
  if (!group || group.name === name) return null
  return {
    type: 'RENAME_GROUP',
    label: 'Rename group',
    payload: { groups: { [groupId]: { ...group, name } } },
    inverse: { groups: { [groupId]: group } },
  }
}

export const recolourGroup = (groupId, colour) => (state) => {
  const group = state.groups[groupId]
  if (!group) return null
  return {
    type: 'RECOLOUR_GROUP',
    label: 'Recolour group',
    payload: { groups: { [groupId]: { ...group, colour } } },
    inverse: { groups: { [groupId]: group } },
  }
}

export const addToGroup = (groupId, guestId) => (state) => {
  const group = state.groups[groupId]
  const guest = state.guests[guestId]
  if (!group || !guest) return null
  const prevGroupId = guest.groupId
  const prevSubgroupId = guest.subgroupId
  const prevFamilyId = guest.familyId
  const groupsForward = {}
  const groupsInverse = {}
  const subgroupsForward = {}
  const subgroupsInverse = {}
  const familiesForward = {}
  const familiesInverse = {}
  // Remove from previous group
  if (prevGroupId && state.groups[prevGroupId]) {
    const prev = state.groups[prevGroupId]
    groupsInverse[prevGroupId] = prev
    groupsForward[prevGroupId] = {
      ...prev,
      memberIds: (prev.memberIds || []).filter((id) => id !== guestId),
    }
  }
  // Remove from previous subgroup — crossing groups leaves stale subgroupId otherwise
  if (prevSubgroupId) {
    const prevSg = (state.subgroups || {})[prevSubgroupId]
    if (prevSg) {
      subgroupsInverse[prevSubgroupId] = prevSg
      subgroupsForward[prevSubgroupId] = {
        ...prevSg,
        memberIds: (prevSg.memberIds || []).filter((id) => id !== guestId),
      }
    }
  }
  // Remove from previous family — same reasoning as subgroup above
  if (prevFamilyId) {
    const prevFam = (state.families || {})[prevFamilyId]
    if (prevFam) {
      familiesInverse[prevFamilyId] = prevFam
      familiesForward[prevFamilyId] = {
        ...prevFam,
        memberIds: (prevFam.memberIds || []).filter((id) => id !== guestId),
      }
    }
  }
  groupsInverse[groupId] = group
  groupsForward[groupId] = {
    ...group,
    memberIds: [...(group.memberIds || []).filter((id) => id !== guestId), guestId],
  }
  return {
    type: 'ADD_TO_GROUP',
    label: 'Add to group',
    payload: {
      groups: groupsForward,
      ...(Object.keys(subgroupsForward).length ? { subgroups: subgroupsForward } : {}),
      ...(Object.keys(familiesForward).length ? { families: familiesForward } : {}),
      guests: { [guestId]: { ...guest, groupId, subgroupId: null, familyId: null } },
    },
    inverse: {
      groups: groupsInverse,
      ...(Object.keys(subgroupsInverse).length ? { subgroups: subgroupsInverse } : {}),
      ...(Object.keys(familiesInverse).length ? { families: familiesInverse } : {}),
      guests: { [guestId]: guest },
    },
  }
}

export const mergeGroups = (sourceGroupId, targetGroupId) => (state) => {
  const source = state.groups[sourceGroupId]
  const target = state.groups[targetGroupId]
  if (!source || !target || sourceGroupId === targetGroupId) return null
  const memberIds = (source.memberIds || []).filter((id) => state.guests[id])
  const guestsForward = {}
  const guestsInverse = {}
  memberIds.forEach((gid) => {
    const g = state.guests[gid]
    if (!g) return
    guestsInverse[gid] = g
    guestsForward[gid] = { ...g, groupId: targetGroupId }
  })
  const existingTargetIds = new Set(target.memberIds || [])
  const newTargetMemberIds = [
    ...(target.memberIds || []),
    ...memberIds.filter((id) => !existingTargetIds.has(id)),
  ]
  return {
    type: 'MERGE_GROUPS',
    label: 'Merge groups',
    payload: {
      groups: {
        [sourceGroupId]: null,
        [targetGroupId]: { ...target, memberIds: newTargetMemberIds },
      },
      guests: guestsForward,
    },
    inverse: {
      groups: { [sourceGroupId]: source, [targetGroupId]: target },
      guests: guestsInverse,
    },
  }
}

export const removeFromGroup = (guestId) => (state) => {
  const guest = state.guests[guestId]
  if (!guest || !guest.groupId) return null
  const group = state.groups[guest.groupId]
  // Also clear any subgroup / family membership
  const sg = guest.subgroupId ? (state.subgroups || {})[guest.subgroupId] : null
  const fam = guest.familyId ? (state.families || {})[guest.familyId] : null
  return {
    type: 'REMOVE_FROM_GROUP',
    label: 'Remove from group',
    payload: {
      guests: { [guestId]: { ...guest, groupId: null, subgroupId: null, familyId: null } },
      ...(group
        ? {
            groups: {
              [group.id]: {
                ...group,
                memberIds: (group.memberIds || []).filter((id) => id !== guestId),
              },
            },
          }
        : {}),
      ...(sg
        ? {
            subgroups: {
              [sg.id]: { ...sg, memberIds: (sg.memberIds || []).filter((id) => id !== guestId) },
            },
          }
        : {}),
      ...(fam
        ? {
            families: {
              [fam.id]: { ...fam, memberIds: (fam.memberIds || []).filter((id) => id !== guestId) },
            },
          }
        : {}),
    },
    inverse: {
      guests: { [guestId]: guest },
      ...(group ? { groups: { [group.id]: group } } : {}),
      ...(sg ? { subgroups: { [sg.id]: sg } } : {}),
      ...(fam ? { families: { [fam.id]: fam } } : {}),
    },
  }
}

// ── subgroups ────────────────────────────────────────────────────────────────

const SUBGROUP_COLOURS = [
  '#9B7FA6', '#5C9E72', '#D08C3A', '#4E8EBE', '#B8607A',
  '#8C6E4A', '#4E9A8E', '#9E7A3A', '#5E6EAE', '#8E5E6E',
]

export const createSubgroup = (parentGroupId, { name, colour } = {}) => (state) => {
  const group = state.groups[parentGroupId]
  if (!group) return null
  const id = makeId('sg')
  const idx = Object.keys(state.subgroups || {}).length
  const subgroup = {
    id,
    name: name || 'Subgroup',
    colour: colour || SUBGROUP_COLOURS[idx % SUBGROUP_COLOURS.length],
    parentGroupId,
    memberIds: [],
  }
  return {
    type: 'CREATE_SUBGROUP',
    label: 'Create subgroup',
    payload: { subgroups: { [id]: subgroup } },
    inverse: { subgroups: { [id]: null } },
    meta: { newSubgroupId: id },
  }
}

export const renameSubgroup = (subgroupId, name) => (state) => {
  const sg = (state.subgroups || {})[subgroupId]
  if (!sg || sg.name === name) return null
  return {
    type: 'RENAME_SUBGROUP',
    label: 'Rename subgroup',
    payload: { subgroups: { [subgroupId]: { ...sg, name } } },
    inverse: { subgroups: { [subgroupId]: sg } },
  }
}

export const recolourSubgroup = (subgroupId, colour) => (state) => {
  const sg = (state.subgroups || {})[subgroupId]
  if (!sg) return null
  return {
    type: 'RECOLOUR_SUBGROUP',
    label: 'Recolour subgroup',
    payload: { subgroups: { [subgroupId]: { ...sg, colour } } },
    inverse: { subgroups: { [subgroupId]: sg } },
  }
}

export const dissolveSubgroup = (subgroupId) => (state) => {
  const sg = (state.subgroups || {})[subgroupId]
  if (!sg) return null
  // Also dissolve any families attached to this subgroup
  const ownFamilies = Object.values(state.families || {}).filter(
    (f) => f.parentSubgroupId === subgroupId
  )
  const familiesForward = {}
  const familiesInverse = {}
  ownFamilies.forEach((f) => {
    familiesInverse[f.id] = f
    familiesForward[f.id] = null
  })
  const guestsForward = {}
  const guestsInverse = {}
  ;(sg.memberIds || []).forEach((gid) => {
    const g = state.guests[gid]
    if (!g) return
    guestsInverse[gid] = g
    guestsForward[gid] = { ...g, subgroupId: null, familyId: null }
  })
  return {
    type: 'DISSOLVE_SUBGROUP',
    label: 'Dissolve subgroup',
    payload: {
      subgroups: { [subgroupId]: null },
      families: familiesForward,
      guests: guestsForward,
    },
    inverse: {
      subgroups: { [subgroupId]: sg },
      families: familiesInverse,
      guests: guestsInverse,
    },
  }
}

export const addToSubgroup = (subgroupId, guestId) => (state) => {
  const sg = (state.subgroups || {})[subgroupId]
  const guest = state.guests[guestId]
  if (!sg || !guest) return null
  const parentGroupId = sg.parentGroupId
  const group = state.groups[parentGroupId]
  if (!group) return null

  const prevSubgroupId = guest.subgroupId
  const prevGroupId = guest.groupId
  const prevFamilyId = guest.familyId

  const groupsForward = {}
  const groupsInverse = {}
  const subgroupsForward = {}
  const subgroupsInverse = {}
  const familiesForward = {}
  const familiesInverse = {}

  // Remove from previous subgroup if it's a different one
  if (prevSubgroupId && prevSubgroupId !== subgroupId) {
    const prevSg = (state.subgroups || {})[prevSubgroupId]
    if (prevSg) {
      subgroupsInverse[prevSubgroupId] = prevSg
      subgroupsForward[prevSubgroupId] = {
        ...prevSg,
        memberIds: (prevSg.memberIds || []).filter((id) => id !== guestId),
      }
    }
  }
  // Landing directly on a subgroup always exits any family — family is deeper
  if (prevFamilyId) {
    const prevFam = (state.families || {})[prevFamilyId]
    if (prevFam) {
      familiesInverse[prevFamilyId] = prevFam
      familiesForward[prevFamilyId] = {
        ...prevFam,
        memberIds: (prevFam.memberIds || []).filter((id) => id !== guestId),
      }
    }
  }
  // Remove from previous parent group if moving to a different group
  if (prevGroupId && prevGroupId !== parentGroupId && state.groups[prevGroupId]) {
    const prevGrp = state.groups[prevGroupId]
    groupsInverse[prevGroupId] = prevGrp
    groupsForward[prevGroupId] = {
      ...prevGrp,
      memberIds: (prevGrp.memberIds || []).filter((id) => id !== guestId),
    }
  }
  // Add to target subgroup's memberIds
  subgroupsInverse[subgroupId] = sg
  subgroupsForward[subgroupId] = {
    ...sg,
    memberIds: [...(sg.memberIds || []).filter((id) => id !== guestId), guestId],
  }
  // Ensure guest is in the parent group's memberIds
  groupsInverse[parentGroupId] = group
  groupsForward[parentGroupId] = {
    ...group,
    memberIds: (group.memberIds || []).includes(guestId)
      ? group.memberIds
      : [...(group.memberIds || []), guestId],
  }

  return {
    type: 'ADD_TO_SUBGROUP',
    label: 'Add to subgroup',
    payload: {
      subgroups: subgroupsForward,
      groups: groupsForward,
      ...(Object.keys(familiesForward).length ? { families: familiesForward } : {}),
      guests: { [guestId]: { ...guest, groupId: parentGroupId, subgroupId, familyId: null } },
    },
    inverse: {
      subgroups: subgroupsInverse,
      groups: groupsInverse,
      ...(Object.keys(familiesInverse).length ? { families: familiesInverse } : {}),
      guests: { [guestId]: guest },
    },
  }
}

export const removeFromSubgroup = (guestId) => (state) => {
  const guest = state.guests[guestId]
  if (!guest || !guest.subgroupId) return null
  const sg = (state.subgroups || {})[guest.subgroupId]
  const fam = guest.familyId ? (state.families || {})[guest.familyId] : null
  return {
    type: 'REMOVE_FROM_SUBGROUP',
    label: 'Remove from subgroup',
    payload: {
      guests: { [guestId]: { ...guest, subgroupId: null, familyId: null } },
      ...(sg
        ? {
            subgroups: {
              [sg.id]: { ...sg, memberIds: (sg.memberIds || []).filter((id) => id !== guestId) },
            },
          }
        : {}),
      ...(fam
        ? {
            families: {
              [fam.id]: { ...fam, memberIds: (fam.memberIds || []).filter((id) => id !== guestId) },
            },
          }
        : {}),
    },
    inverse: {
      guests: { [guestId]: guest },
      ...(sg ? { subgroups: { [sg.id]: sg } } : {}),
      ...(fam ? { families: { [fam.id]: fam } } : {}),
    },
  }
}

export const assignSubgroupToTable = (subgroupId, tableId) => (state) => {
  const sg = (state.subgroups || {})[subgroupId]
  const target = state.tables[tableId]
  if (!sg || !target) return null
  const memberIds = (sg.memberIds || []).filter((id) => state.guests[id])
  if (!memberIds.length) return null

  const affected = new Set([tableId])
  memberIds.forEach((gid) => {
    const t = state.guests[gid]?.assignedTableId
    if (t) affected.add(t)
  })

  const inverseGuests = {}
  const inverseTables = {}
  memberIds.forEach((gid) => { inverseGuests[gid] = state.guests[gid] })
  affected.forEach((tid) => { inverseTables[tid] = state.tables[tid] })

  const memberSet = new Set(memberIds)
  const working = {}
  affected.forEach((tid) => {
    working[tid] = withoutMembers(
      [...(state.tables[tid].assignedGuestIds || [])],
      memberSet,
      state.tables[tid].seatMode
    )
  })
  const placed = placeMembers(working[tableId], target.capacity, target.seatMode, memberIds)
  if (!placed) return null
  working[tableId] = placed.assignedGuestIds

  const forwardGuests = {}
  memberIds.forEach((gid, i) => {
    forwardGuests[gid] = {
      ...state.guests[gid],
      assignedTableId: tableId,
      assignedSeatId: placed.indices ? seatId(tableId, placed.indices[i]) : null,
    }
  })
  const forwardTables = {}
  affected.forEach((tid) => {
    forwardTables[tid] = { ...state.tables[tid], assignedGuestIds: working[tid] }
  })

  return {
    type: 'ASSIGN_SUBGROUP',
    label: 'Seat subgroup',
    payload: { guests: forwardGuests, tables: forwardTables },
    inverse: { guests: inverseGuests, tables: inverseTables },
  }
}

// TODO(family-ux): undo/redo (Ctrl+Z/Y) for family actions rides the same
// generic command pattern group/subgroup already use and works there, but
// was never manually confirmed end-to-end for family specifically (create,
// dissolve, addToFamily, assignFamilyToTable) in a live session. Low risk,
// unverified. See tmp/family-ux-followups.md #11.
// ── families ─────────────────────────────────────────────────────────────────
// A family is the deepest containment level: it can sit directly under a Group,
// under a Subgroup (which implies its Group), or stand alone with no parent at
// all — the same way a Group can. A guest has at most one deepest container at
// a time, mirroring how subgroupId already implies a matching groupId.

// TODO(family-ux): only 8 colours, cycles by index — confirmed real collisions
// once a plan has >8 families (two families end up sharing a ring colour,
// which defeats the "spot a family at a glance" goal the ring exists for).
// See tmp/family-ux-followups.md #1.
const FAMILY_COLOURS = [
  '#B3866B',
  '#6B8FA3',
  '#8FA36B',
  '#A36B8F',
  '#6BA3A0',
  '#A38F6B',
  '#7A6BA3',
  '#A3766B',
]

export const createFamily =
  ({ parentGroupId = null, parentSubgroupId = null, name, colour } = {}) =>
  (state) => {
    let resolvedGroupId = parentGroupId
    if (parentSubgroupId) {
      const parentSg = (state.subgroups || {})[parentSubgroupId]
      if (!parentSg) return null
      resolvedGroupId = parentSg.parentGroupId
    } else if (parentGroupId && !state.groups[parentGroupId]) {
      return null
    }
    const id = makeId('fam')
    const idx = Object.keys(state.families || {}).length
    const family = {
      id,
      name: name || 'Family',
      colour: colour || FAMILY_COLOURS[idx % FAMILY_COLOURS.length],
      parentGroupId: resolvedGroupId,
      parentSubgroupId: parentSubgroupId || null,
      memberIds: [],
    }
    return {
      type: 'CREATE_FAMILY',
      label: 'Create family',
      payload: { families: { [id]: family } },
      inverse: { families: { [id]: null } },
      meta: { newFamilyId: id },
    }
  }

export const renameFamily = (familyId, name) => (state) => {
  const f = (state.families || {})[familyId]
  if (!f || f.name === name) return null
  return {
    type: 'RENAME_FAMILY',
    label: 'Rename family',
    payload: { families: { [familyId]: { ...f, name } } },
    inverse: { families: { [familyId]: f } },
  }
}

export const recolourFamily = (familyId, colour) => (state) => {
  const f = (state.families || {})[familyId]
  if (!f) return null
  return {
    type: 'RECOLOUR_FAMILY',
    label: 'Recolour family',
    payload: { families: { [familyId]: { ...f, colour } } },
    inverse: { families: { [familyId]: f } },
  }
}

export const dissolveFamily = (familyId) => (state) => {
  const f = (state.families || {})[familyId]
  if (!f) return null
  const guestsForward = {}
  const guestsInverse = {}
  ;(f.memberIds || []).forEach((gid) => {
    const g = state.guests[gid]
    if (!g) return
    guestsInverse[gid] = g
    guestsForward[gid] = { ...g, familyId: null }
  })
  return {
    type: 'DISSOLVE_FAMILY',
    label: 'Dissolve family',
    payload: { families: { [familyId]: null }, guests: guestsForward },
    inverse: { families: { [familyId]: f }, guests: guestsInverse },
  }
}

// Adds a guest to a family, re-parenting them into the family's own group/
// subgroup chain (or clearing group/subgroup entirely for a standalone
// family) — the same "land on the deepest container, inherit its ancestry"
// rule addToSubgroup already applies one level up.
// TODO(family-ux): a guest's plus-one (guest.plusOneOf) never auto-follows
// into the family when the primary guest joins — undecided whether that's
// the right default or a gap. See tmp/family-ux-followups.md #13.
export const addToFamily = (familyId, guestId) => (state) => {
  const fam = (state.families || {})[familyId]
  const guest = state.guests[guestId]
  if (!fam || !guest) return null

  const prevFamilyId = guest.familyId
  const prevSubgroupId = guest.subgroupId
  const prevGroupId = guest.groupId

  const familiesForward = {}
  const familiesInverse = {}
  const subgroupsForward = {}
  const subgroupsInverse = {}
  const groupsForward = {}
  const groupsInverse = {}

  if (prevFamilyId && prevFamilyId !== familyId) {
    const prevFam = (state.families || {})[prevFamilyId]
    if (prevFam) {
      familiesInverse[prevFamilyId] = prevFam
      familiesForward[prevFamilyId] = {
        ...prevFam,
        memberIds: (prevFam.memberIds || []).filter((id) => id !== guestId),
      }
    }
  }

  familiesInverse[familyId] = fam
  familiesForward[familyId] = {
    ...fam,
    memberIds: [...(fam.memberIds || []).filter((id) => id !== guestId), guestId],
  }

  let nextSubgroupId
  let nextGroupId

  if (fam.parentSubgroupId) {
    nextSubgroupId = fam.parentSubgroupId
    nextGroupId = fam.parentGroupId
    if (prevSubgroupId && prevSubgroupId !== nextSubgroupId) {
      const prevSg = (state.subgroups || {})[prevSubgroupId]
      if (prevSg) {
        subgroupsInverse[prevSubgroupId] = prevSg
        subgroupsForward[prevSubgroupId] = {
          ...prevSg,
          memberIds: (prevSg.memberIds || []).filter((id) => id !== guestId),
        }
      }
    }
    const targetSg = state.subgroups[nextSubgroupId]
    subgroupsInverse[nextSubgroupId] = targetSg
    subgroupsForward[nextSubgroupId] = {
      ...targetSg,
      memberIds: (targetSg.memberIds || []).includes(guestId)
        ? targetSg.memberIds
        : [...(targetSg.memberIds || []), guestId],
    }
  } else {
    // Directly under a group, or fully standalone — either way, no subgroup.
    nextSubgroupId = null
    nextGroupId = fam.parentGroupId
    if (prevSubgroupId) {
      const prevSg = (state.subgroups || {})[prevSubgroupId]
      if (prevSg) {
        subgroupsInverse[prevSubgroupId] = prevSg
        subgroupsForward[prevSubgroupId] = {
          ...prevSg,
          memberIds: (prevSg.memberIds || []).filter((id) => id !== guestId),
        }
      }
    }
  }

  if (prevGroupId !== nextGroupId) {
    if (prevGroupId && state.groups[prevGroupId]) {
      const prevGrp = state.groups[prevGroupId]
      groupsInverse[prevGroupId] = prevGrp
      groupsForward[prevGroupId] = {
        ...prevGrp,
        memberIds: (prevGrp.memberIds || []).filter((id) => id !== guestId),
      }
    }
    if (nextGroupId && state.groups[nextGroupId]) {
      const nextGrp = state.groups[nextGroupId]
      groupsInverse[nextGroupId] = nextGrp
      groupsForward[nextGroupId] = {
        ...nextGrp,
        memberIds: (nextGrp.memberIds || []).includes(guestId)
          ? nextGrp.memberIds
          : [...(nextGrp.memberIds || []), guestId],
      }
    }
  } else if (nextGroupId && state.groups[nextGroupId]) {
    const grp = state.groups[nextGroupId]
    if (!(grp.memberIds || []).includes(guestId)) {
      groupsInverse[nextGroupId] = grp
      groupsForward[nextGroupId] = { ...grp, memberIds: [...(grp.memberIds || []), guestId] }
    }
  }

  return {
    type: 'ADD_TO_FAMILY',
    label: 'Add to family',
    payload: {
      families: familiesForward,
      ...(Object.keys(subgroupsForward).length ? { subgroups: subgroupsForward } : {}),
      ...(Object.keys(groupsForward).length ? { groups: groupsForward } : {}),
      guests: {
        [guestId]: { ...guest, groupId: nextGroupId, subgroupId: nextSubgroupId, familyId },
      },
    },
    inverse: {
      families: familiesInverse,
      ...(Object.keys(subgroupsInverse).length ? { subgroups: subgroupsInverse } : {}),
      ...(Object.keys(groupsInverse).length ? { groups: groupsInverse } : {}),
      guests: { [guestId]: guest },
    },
  }
}

export const removeFromFamily = (guestId) => (state) => {
  const guest = state.guests[guestId]
  if (!guest || !guest.familyId) return null
  const fam = (state.families || {})[guest.familyId]
  return {
    type: 'REMOVE_FROM_FAMILY',
    label: 'Remove from family',
    payload: {
      guests: { [guestId]: { ...guest, familyId: null } },
      ...(fam
        ? {
            families: {
              [fam.id]: { ...fam, memberIds: (fam.memberIds || []).filter((id) => id !== guestId) },
            },
          }
        : {}),
    },
    inverse: {
      guests: { [guestId]: guest },
      ...(fam ? { families: { [fam.id]: fam } } : {}),
    },
  }
}

// `seatIndex` is set when the family was dropped onto a specific SeatSlot — it
// pins where the family's run starts. Null means "anywhere it fits".
export const assignFamilyToTable = (familyId, tableId, seatIndex = null) => (state) => {
  const fam = (state.families || {})[familyId]
  const target = state.tables[tableId]
  if (!fam || !target) return null
  const memberIds = (fam.memberIds || []).filter((id) => state.guests[id])
  if (!memberIds.length) return null

  const affected = new Set([tableId])
  memberIds.forEach((gid) => {
    const t = state.guests[gid]?.assignedTableId
    if (t) affected.add(t)
  })

  const inverseGuests = {}
  const inverseTables = {}
  memberIds.forEach((gid) => {
    inverseGuests[gid] = state.guests[gid]
  })
  affected.forEach((tid) => {
    inverseTables[tid] = state.tables[tid]
  })

  const memberSet = new Set(memberIds)
  const working = {}
  affected.forEach((tid) => {
    working[tid] = withoutMembers(
      [...(state.tables[tid].assignedGuestIds || [])],
      memberSet,
      state.tables[tid].seatMode
    )
  })
  const placed = placeMembers(
    working[tableId],
    target.capacity,
    target.seatMode,
    memberIds,
    seatIndex
  )
  if (!placed) return null
  working[tableId] = placed.assignedGuestIds

  const forwardGuests = {}
  memberIds.forEach((gid, i) => {
    forwardGuests[gid] = {
      ...state.guests[gid],
      assignedTableId: tableId,
      assignedSeatId: placed.indices ? seatId(tableId, placed.indices[i]) : null,
    }
  })
  const forwardTables = {}
  affected.forEach((tid) => {
    forwardTables[tid] = { ...state.tables[tid], assignedGuestIds: working[tid] }
  })

  return {
    type: 'ASSIGN_FAMILY',
    label: 'Seat family',
    payload: { guests: forwardGuests, tables: forwardTables },
    inverse: { guests: inverseGuests, tables: inverseTables },
  }
}

// ── zones ───────────────────────────────────────────────────────────────────

export const addZone =
  ({ x, y, width, height, shape = 'rect', label = 'Zone', colour = '#E8E0D5' }) =>
  () => {
    const zone = {
      id: makeId('zone'),
      label,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      shape,
      colour,
    }
    return {
      type: 'ADD_ZONE',
      label: 'Add zone',
      payload: { zones: { [zone.id]: zone } },
      inverse: { zones: { [zone.id]: null } },
      meta: { newZoneId: zone.id },
    }
  }

export const removeZone = (id) => (state) => {
  const zone = state.zones[id]
  if (!zone) return null
  return {
    type: 'REMOVE_ZONE',
    label: 'Remove zone',
    payload: { zones: { [id]: null } },
    inverse: { zones: { [id]: zone } },
  }
}

export const moveZone = (id, x, y) => (state) => {
  const zone = state.zones[id]
  if (!zone) return null
  return {
    type: 'MOVE_ZONE',
    label: 'Move zone',
    payload: { zones: { [id]: { ...zone, x: Math.round(x), y: Math.round(y) } } },
    inverse: { zones: { [id]: zone } },
  }
}

export const resizeZone = (id, dims) => (state) => {
  const zone = state.zones[id]
  if (!zone) return null
  const next = { ...zone }
  for (const k of ['x', 'y', 'width', 'height']) {
    if (dims[k] != null) next[k] = Math.round(dims[k])
  }
  return {
    type: 'RESIZE_ZONE',
    label: 'Resize zone',
    payload: { zones: { [id]: next } },
    inverse: { zones: { [id]: zone } },
  }
}

export const renameZone = (id, label) => (state) => {
  const zone = state.zones[id]
  if (!zone || zone.label === label) return null
  return {
    type: 'RENAME_ZONE',
    label: 'Rename zone',
    payload: { zones: { [id]: { ...zone, label } } },
    inverse: { zones: { [id]: zone } },
  }
}

// ── room spaces (multi-room) ─────────────────────────────────────────────────
// The room is a single object holding a `spaces` array, so these actions patch
// the whole room (mirroring RESIZE_ROOM). Live move/resize/vertex-drag use
// updateRoom for smooth feedback and dispatch the final command on pointer-up.

const SPACE_COLOURS = ['#FAF8F5', '#F3EFEA', '#EEF3F1', '#F1EEF5', '#F5EFEA']

export const addSpace =
  (space = {}) =>
  (state) => {
    const room = state.room
    const count = (room.spaces || []).length
    const base =
      space.shape === 'polygon'
        ? { shape: 'polygon', vertices: space.vertices || [] }
        : { shape: 'rect', width: space.width || 400, height: space.height || 300 }
    const sp = {
      id: makeId('space'),
      label: space.label || `Space ${count + 1}`,
      x: Math.round(space.x || 0),
      y: Math.round(space.y || 0),
      backgroundColour: space.backgroundColour || SPACE_COLOURS[count % SPACE_COLOURS.length],
      ...base,
    }
    return {
      type: 'ADD_SPACE',
      label: 'Add space',
      payload: { room: { ...room, spaces: [...(room.spaces || []), sp] } },
      inverse: { room },
      meta: { newSpaceId: sp.id },
    }
  }

export const removeSpace = (id) => (state) => {
  const room = state.room
  const spaces = room.spaces || []
  if (spaces.length <= 1 || !spaces.some((s) => s.id === id)) return null // keep at least one
  // Also null-out any wall elements referencing this space.
  const prevWallElements = state.wallElements || {}
  const nextWallElements = {}
  Object.entries(prevWallElements).forEach(([wid, we]) => {
    nextWallElements[wid] = we?.spaceId === id ? null : we
  })
  return {
    type: 'REMOVE_SPACE',
    label: 'Remove space',
    payload: {
      room: {
        ...room,
        spaces: spaces.filter((s) => s.id !== id),
        joins: (room.joins || []).filter((j) => j.a !== id && j.b !== id),
      },
      wallElements: nextWallElements,
    },
    inverse: { room, wallElements: prevWallElements },
  }
}

const patchSpace = (type, label) => (id, patch) => (state) => {
  const room = state.room
  const spaces = room.spaces || []
  if (!spaces.some((s) => s.id === id)) return null
  return {
    type,
    label,
    payload: { room: { ...room, spaces: spaces.map((s) => (s.id === id ? { ...s, ...patch } : s)) } },
    inverse: { room },
  }
}

export const renameSpace = patchSpace('RENAME_SPACE', 'Rename space')
export const recolourSpace = patchSpace('RECOLOUR_SPACE', 'Recolour space')
export const resizeSpace = patchSpace('RESIZE_SPACE', 'Resize space')

// Toggle a join between two spaces (open boundary so they read as one floor).
export const joinSpaces = (a, b) => (state) => {
  const room = state.room
  if (a === b) return null
  const joins = room.joins || []
  const exists = joins.some((j) => (j.a === a && j.b === b) || (j.a === b && j.b === a))
  const next = exists
    ? joins.filter((j) => !((j.a === a && j.b === b) || (j.a === b && j.b === a)))
    : [...joins, { a, b }]
  return {
    type: exists ? 'UNJOIN_SPACES' : 'JOIN_SPACES',
    label: exists ? 'Separate spaces' : 'Join spaces',
    payload: { room: { ...room, joins: next } },
    inverse: { room },
  }
}

// ── wall elements (doors, openings on space walls) ───────────────────────────

export const addWallElement =
  ({ spaceId, wallIndex, position, type, widthUnits, swingInward = true, swingSide = 'left' }) =>
  () => {
    const id = makeId('we')
    const we = { id, spaceId, wallIndex, position, type, widthUnits, swingInward, swingSide }
    return {
      type: 'ADD_WALL_ELEMENT',
      label: `Add ${type}`,
      payload: { wallElements: { [id]: we } },
      inverse: { wallElements: { [id]: null } },
    }
  }

export const removeWallElement = (id) => (state) => {
  const we = (state.wallElements || {})[id]
  if (!we) return null
  return {
    type: 'REMOVE_WALL_ELEMENT',
    label: 'Remove wall element',
    payload: { wallElements: { [id]: null } },
    inverse: { wallElements: { [id]: we } },
  }
}

export const updateWallElement = (id, patch) => (state) => {
  const we = (state.wallElements || {})[id]
  if (!we) return null
  return {
    type: 'UPDATE_WALL_ELEMENT',
    label: 'Update wall element',
    payload: { wallElements: { [id]: { ...we, ...patch } } },
    inverse: { wallElements: { [id]: we } },
  }
}

// ── pillars ──────────────────────────────────────────────────────────────────

export const addPillar =
  ({ x, y, radiusUnits = 15 }) =>
  () => {
    const id = makeId('pillar')
    const pillar = { id, x: Math.round(x), y: Math.round(y), radiusUnits }
    return {
      type: 'ADD_PILLAR',
      label: 'Add pillar',
      payload: { pillars: { [id]: pillar } },
      inverse: { pillars: { [id]: null } },
    }
  }

export const removePillar = (id) => (state) => {
  const pillar = (state.pillars || {})[id]
  if (!pillar) return null
  return {
    type: 'REMOVE_PILLAR',
    label: 'Remove pillar',
    payload: { pillars: { [id]: null } },
    inverse: { pillars: { [id]: pillar } },
  }
}

// ── plan details, settings, seating rules ───────────────────────────────────
// Singleton slices are shallow-merged by applyPatch, so an inverse only needs
// the previous values of the keys actually being patched. Same factory shape as
// patchSpace above.
const patchSingleton = (key, type, label) => (patch) => (state) => {
  const prev = state[key] || {}
  const keys = Object.keys(patch)
  if (keys.every((k) => prev[k] === patch[k])) return null
  const inverse = {}
  keys.forEach((k) => {
    inverse[k] = prev[k]
  })
  return { type, label, payload: { [key]: patch }, inverse: { [key]: inverse } }
}

export const updateMeta = patchSingleton('meta', 'UPDATE_META', 'Edit plan details')
export const updateSettings = patchSingleton('settings', 'UPDATE_SETTINGS', 'Change settings')

// `constraints` is a whole-array slice in applyPatch, so the inverse is simply
// the previous array.
export const addConstraint = (c) => (state) => {
  const constraints = state.constraints || []
  const cst = { id: makeId('cst'), ...c }
  return {
    type: 'ADD_CONSTRAINT',
    label: 'Add seating rule',
    payload: { constraints: [...constraints, cst] },
    inverse: { constraints },
    meta: { newConstraintId: cst.id },
  }
}

export const removeConstraint = (id) => (state) => {
  const constraints = state.constraints || []
  if (!constraints.some((c) => c.id === id)) return null
  return {
    type: 'REMOVE_CONSTRAINT',
    label: 'Remove seating rule',
    payload: { constraints: constraints.filter((c) => c.id !== id) },
    inverse: { constraints },
  }
}

// Registry the store iterates over to create bound dispatchers.
export const actionCreators = {
  addTable,
  createCustomTable,
  setPerSideSeats,
  removeTable,
  duplicateTable,
  moveTable,
  renameTable,
  changeCapacity,
  changeTableType,
  setDesignation,
  setTableColour,
  rotateTable,
  resizeTable,
  saveTablePreset,
  deleteTablePreset,
  calibrate,
  setRoomSizeUnits,
  setSeatMode,
  clearTable,
  addGuest,
  updateGuest,
  removeGuest,
  removeGuests,
  assignGuest,
  swapSeatGuests,
  unassignGuest,
  assignGroupToTable,
  createGroup,
  createEmptyGroup,
  dissolveGroup,
  renameGroup,
  recolourGroup,
  addToGroup,
  mergeGroups,
  removeFromGroup,
  createSubgroup,
  renameSubgroup,
  recolourSubgroup,
  dissolveSubgroup,
  addToSubgroup,
  removeFromSubgroup,
  assignSubgroupToTable,
  createFamily,
  renameFamily,
  recolourFamily,
  dissolveFamily,
  addToFamily,
  removeFromFamily,
  assignFamilyToTable,
  addZone,
  removeZone,
  moveZone,
  resizeZone,
  renameZone,
  addSpace,
  removeSpace,
  renameSpace,
  recolourSpace,
  resizeSpace,
  joinSpaces,
  addWallElement,
  removeWallElement,
  updateWallElement,
  addPillar,
  removePillar,
  updateMeta,
  updateSettings,
  addConstraint,
  removeConstraint,
}
