import { getTableGeometry, DEFAULT_PPU } from './seatPositions.js'

/**
 * Build a to-scale SVG of the room, zones and tables from a plain plan `doc`
 * (no store, no React) so it can be reused by the PDF exporter and the
 * read-only public viewer. Uses the same getTableGeometry the editor uses, so
 * the printed plan matches the screen.
 *
 * Seats render one of three ways (`seatLabels`):
 *   number — a numbered circle per seat (the on-screen / public-view default)
 *   name   — a rectangular cell holding the guest's first and last name on two
 *            lines, sized so no two cells on the page can overlap. This is what
 *            the one-page printed seating chart uses.
 *   none   — the seat shape only
 */

const escAttr = (s) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

function shapePath(geom) {
  if (geom.shape === 'circle') return `<circle cx="0" cy="0" r="${geom.radius}" />`
  if (geom.shape === 'rect') {
    const rx = geom.rounded ? 14 : 6
    return `<rect x="${-geom.width / 2}" y="${-geom.height / 2}" width="${geom.width}" height="${geom.height}" rx="${rx}" />`
  }
  return `<path d="M ${-geom.radius} ${geom.cy} A ${geom.radius} ${geom.radius} 0 0 1 ${geom.radius} ${geom.cy} Z" />`
}

/** Compute door arc path string (same logic as canvas RoomSpaces.jsx). */
function buildDoorPath(we, seg, scale) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)
  if (!len) return ''
  const ux = (seg.x2 - seg.x1) / len
  const uy = (seg.y2 - seg.y1) / len
  const cx = seg.x1 + we.position * (seg.x2 - seg.x1)
  const cy = seg.y1 + we.position * (seg.y2 - seg.y1)
  const half = (we.widthUnits * scale) / 2
  const jambA = { x: cx - half * ux, y: cy - half * uy }
  const jambB = { x: cx + half * ux, y: cy + half * uy }
  const hinge = we.swingSide === 'left' ? jambA : jambB
  const free = we.swingSide === 'left' ? jambB : jambA
  const normalDir = we.swingInward ? 1 : -1
  const doorLen = half * 2
  const openPos = { x: hinge.x + doorLen * -uy * normalDir, y: hinge.y + doorLen * ux * normalDir }
  const fhx = free.x - hinge.x, fhy = free.y - hinge.y
  const ohx = openPos.x - hinge.x, ohy = openPos.y - hinge.y
  const sweep = fhx * ohy - fhy * ohx > 0 ? 1 : 0
  const r = (n) => Math.round(n * 10) / 10
  return (
    `M ${r(hinge.x)} ${r(hinge.y)} L ${r(openPos.x)} ${r(openPos.y)} ` +
    `M ${r(free.x)} ${r(free.y)} A ${r(doorLen)} ${r(doorLen)} 0 0 ${sweep} ${r(openPos.x)} ${r(openPos.y)}`
  )
}

/** Wall segments for a space (absolute canvas coords). */
function getWallSegs(sp) {
  if (sp.shape === 'polygon') {
    return sp.vertices.map((v, i) => {
      const nxt = sp.vertices[(i + 1) % sp.vertices.length]
      return { wallIndex: i, x1: sp.x + v.x, y1: sp.y + v.y, x2: sp.x + nxt.x, y2: sp.y + nxt.y }
    })
  }
  return [
    { wallIndex: 0, x1: sp.x, y1: sp.y, x2: sp.x + sp.width, y2: sp.y },
    { wallIndex: 1, x1: sp.x + sp.width, y1: sp.y, x2: sp.x + sp.width, y2: sp.y + sp.height },
    { wallIndex: 2, x1: sp.x + sp.width, y1: sp.y + sp.height, x2: sp.x, y2: sp.y + sp.height },
    { wallIndex: 3, x1: sp.x, y1: sp.y + sp.height, x2: sp.x, y2: sp.y },
  ]
}

// ── name cells ──────────────────────────────────────────────────────────────

const CELL_GAP = 2 // clear space (px) left between two adjacent name cells
const CELL_INSET = 2 // horizontal padding inside a cell, each side
const MAX_CELL_W = 140
const MIN_CELL_W = 10
const MIN_CELL_H = 12
const MAX_CELL_H = 260
const CELL_H_STEP = 4
const LEADING = 1.15 // line pitch as a multiple of the type size
// How far a cell reaches back over its own chair, so a name still reads as
// belonging to that seat rather than floating off it.
const INNER_BITE = 6
export const MIN_NAME_PX = 4.5 // below this, names get ellipsised rather than shrunk further

/** Fallback text metric when no real font metrics are supplied. Linear in size. */
const estimateWidth = (text, fontPx) => String(text).length * fontPx * 0.52

/**
 * Which way is "away from the table" for one seat, in the table's own
 * coordinates.
 *
 * A round table pushes straight out from its centre. A rectangle pushes square
 * off the edge the seat sits on — taking the direction from the centre instead
 * would send an end seat's cell out diagonally and straight into its neighbour's,
 * costing the long tables the width they have least of.
 */
function seatNormal(seat, geom) {
  if (geom.shape === 'rect') {
    if (Math.abs(seat.y) > geom.height / 2) return { x: 0, y: Math.sign(seat.y) }
    if (Math.abs(seat.x) > geom.width / 2) return { x: Math.sign(seat.x), y: 0 }
  }
  const cy = geom.shape === 'half-circle' ? (geom.cy ?? 0) : 0
  const len = Math.hypot(seat.x, seat.y - cy)
  return len < 1e-6 ? { x: 0, y: 1 } : { x: seat.x / len, y: (seat.y - cy) / len }
}

/** A seat's outward direction in world coordinates, table rotation included. */
function outwardOf(seat) {
  if (Number.isFinite(seat.nx) && Number.isFinite(seat.ny)) return { x: seat.nx, y: seat.ny }
  const dx = seat.x - seat.table.x
  const dy = seat.y - seat.table.y
  const len = Math.hypot(dx, dy)
  return len < 1e-6 ? { x: 0, y: 1 } : { x: dx / len, y: dy / len }
}

/**
 * Where a seat's name cell sits.
 *
 * The cell hangs outward from its table rather than being centred on the chair,
 * biting back over the chair by INNER_BITE so it still reads as that seat’s.
 * This is the whole trick: the gap to the next chair is fixed and tight, but the
 * floor outside the table is usually clear — so height is nearly free and width
 * is not.
 */
function cellCentre(seat, out, cellH) {
  const reach = Math.max(0, cellH / 2 - INNER_BITE)
  return { x: seat.x + out.x * reach, y: seat.y + out.y * reach }
}

/**
 * Widest cell that fits at a given height with no two cells overlapping.
 *
 * Two equally sized axis-aligned cells overlap only when their centres are within
 * the cell on BOTH axes, so a pair caps the width only once it is already within
 * `cellH` vertically. Every other pair is free.
 *
 * ponytail: O(n²) over the seat list — ~100 seats on a real plan, so ~5k distance
 * checks per height tried. Swap in a grid/kd-tree only if plans reach thousands.
 */
function widthAt(centres, cellH) {
  let bound = MAX_CELL_W + CELL_GAP
  for (let i = 0; i < centres.length; i++) {
    for (let j = i + 1; j < centres.length; j++) {
      if (Math.abs(centres[i].y - centres[j].y) >= cellH) continue
      const dx = Math.abs(centres[i].x - centres[j].x)
      if (dx < bound) bound = dx
    }
  }
  // The MIN_CELL_W clamp can in principle re-introduce an overlap on a plan with
  // seats stacked almost on top of each other; a readable cell beats an invisible
  // one there.
  return Math.max(MIN_CELL_W, Math.min(bound - CELL_GAP, MAX_CELL_W))
}

/**
 * Largest type size that fits a `w` × `h` cell, where `tokenW` is the width of a
 * representative name at one unit of type.
 *
 * One line each for the given name and the surname. Letting a name run onto more
 * lines would score a bigger point size on paper, but a surname broken into
 * three-letter pieces is less readable, not more — so the width of the cell caps
 * the type however tall the cell is allowed to get.
 */
function nameSizeIn(w, h, tokenW) {
  const textW = w - CELL_INSET * 2
  if (textW <= 0 || tokenW <= 0) return 0
  return Math.max(0, Math.min(textW / tokenW, h / (2 * LEADING)))
}

/**
 * One cell size for the whole plan — uniform, so every name on the sheet is set the
 * same and the chart reads as one document.
 *
 * A taller cell pushes its seat further out, which on a round table opens the gap
 * to the next chair and so buys width as well as height — until the cells reach
 * the next table and it costs width instead. There is no closed form for where
 * that turns, so walk a ladder of heights and take the exact widest cell each one
 * allows.
 *
 * `rank` scores a candidate. It defaults to the type size in plan units, but the
 * exporter passes one that scales by the page fit, because a taller cell also
 * grows the plan and so shrinks everything on the sheet — the two pull against
 * each other and only the printed size settles it. Of the candidates within a
 * whisker of the best, take the shortest: a taller cell that reads no better is
 * just a bigger empty box.
 */
export function solveCells(seats, tokenW, rank = (cell) => cell.basePx) {
  const floor = { cellW: MIN_CELL_W, cellH: MIN_CELL_H, basePx: MIN_NAME_PX }
  if (!seats.length) return floor

  const outs = seats.map(outwardOf)
  const candidates = []
  for (let h = MIN_CELL_H; h <= MAX_CELL_H; h += CELL_H_STEP) {
    const centres = seats.map((s, i) => cellCentre(s, outs[i], h))
    const cellW = widthAt(centres, h)
    candidates.push({ cellW, cellH: h, basePx: nameSizeIn(cellW, h, tokenW) })
  }

  const best = Math.max(...candidates.map(rank))
  if (!(best > 0)) return floor
  return candidates.find((cell) => rank(cell) >= best * 0.98) ?? floor
}

/**
 * Plan bounds grown to hold the name cells. They reach further out than the table
 * halo allows for, so without this the outermost names get clipped off the sheet.
 */
function expandForCells(l, cells) {
  let minX = l.minX
  let minY = l.minY
  let maxX = l.minX + l.width
  let maxY = l.minY + l.height
  l.seats.forEach((s) => {
    const c = cellCentre(s, outwardOf(s), cells.cellH)
    minX = Math.min(minX, c.x - cells.cellW / 2)
    minY = Math.min(minY, c.y - cells.cellH / 2)
    maxX = Math.max(maxX, c.x + cells.cellW / 2)
    maxY = Math.max(maxY, c.y + cells.cellH / 2)
  })
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

/** 90th-percentile value of a numeric array (empty → 1). */
function p90(values) {
  if (!values.length) return 1
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]
}

/**
 * Width of a representative name at one unit of type: the 90th percentile across
 * the plan, so one very long surname wraps inside its own cell rather than setting
 * the type size for the whole sheet.
 */
export function tokenWidthOf(seats, measure) {
  const widths = []
  for (const s of seats) {
    if (!s.guest) continue
    const first = s.guest.firstName || s.guest.fullName || ''
    const last = s.guest.lastName || ''
    widths.push(measure(first.length >= last.length ? first : last, 1))
  }
  return p90(widths)
}

/**
 * Break one name onto a second line, but only at a hyphen. A double-barrelled
 * surname reads perfectly well split where its own hyphen falls; no name reads
 * well split mid-word, so anything else is left whole for the caller to cut.
 */
function wrapToken(text, fontPx, maxW, measure) {
  const name = String(text ?? '')
  if (name === '' || measure(name, fontPx) <= maxW) return [name]
  const at = name.lastIndexOf('-')
  if (at > 0 && at < name.length - 1) {
    const head = name.slice(0, at + 1)
    const tail = name.slice(at + 1)
    if (measure(head, fontPx) <= maxW && measure(tail, fontPx) <= maxW) return [head, tail]
  }
  return [name]
}

/** Shrink `text` until it fits `maxW` at `fontPx`, ellipsising as a last resort. */
function fitToken(text, fontPx, maxW, measure) {
  let s = String(text)
  if (!s) return s
  if (measure(s, fontPx) <= maxW) return s
  while (s.length > 1) {
    s = s.slice(0, -1)
    if (measure(`${s}…`, fontPx) <= maxW) return `${s}…`
  }
  return s
}

// ── layout ──────────────────────────────────────────────────────────────────

const spaceBox = (sp) =>
  sp.shape === 'polygon'
    ? {
        minX: Math.min(...sp.vertices.map((v) => sp.x + v.x)),
        minY: Math.min(...sp.vertices.map((v) => sp.y + v.y)),
        maxX: Math.max(...sp.vertices.map((v) => sp.x + v.x)),
        maxY: Math.max(...sp.vertices.map((v) => sp.y + v.y)),
      }
    : { minX: sp.x, minY: sp.y, maxX: sp.x + sp.width, maxY: sp.y + sp.height }

/**
 * Shared geometry pass: resolves the scale, every table's geometry, the seat
 * list in world (rotation-applied) coordinates, and the drawing bounds. Split
 * out from buildFloorPlanSvg so the PDF exporter can size type against the
 * cells before anything is drawn.
 */
function layoutFloorPlan(doc, { ppu, padPx } = {}) {
  const settings = doc.settings || {}
  const scale = ppu || settings.pixelsPerUnit || DEFAULT_PPU
  const guests = doc.guests || {}
  const tables = Object.values(doc.tables || {})
  const zones = Object.values(doc.zones || {})
  const wallElements = Object.values(doc.wallElements || {}).filter(Boolean)
  const pillars = Object.values(doc.pillars || {}).filter(Boolean)
  const room = doc.room || {}
  const roomW = (room.widthUnits ? room.widthUnits * scale : room.width) || 1200
  const roomH = (room.heightUnits ? room.heightUnits * scale : room.height) || 900

  // Multi-room: render each floor space; fall back to a single rect for old docs.
  const spaces =
    Array.isArray(room.spaces) && room.spaces.length
      ? room.spaces
      : [{ shape: 'rect', x: 0, y: 0, width: roomW, height: roomH, backgroundColour: '#FAF8F5' }]
  const joins = Array.isArray(room.joins) ? room.joins : []

  // Deliberately not seeded at the origin. A room drawn away from (0,0) would
  // otherwise drag all the empty ground back to it onto the printed sheet.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x1, y1, x2, y2) => {
    minX = Math.min(minX, x1)
    minY = Math.min(minY, y1)
    maxX = Math.max(maxX, x2)
    maxY = Math.max(maxY, y2)
  }
  spaces.forEach((sp) => {
    const b = spaceBox(sp)
    grow(b.minX, b.minY, b.maxX, b.maxY)
  })
  // Zones and pillars are frequently placed outside the room rect (a stage or
  // a marquee annexe); they must extend the bounds or they get clipped away.
  zones.forEach((z) => grow(z.x, z.y, z.x + z.width, z.y + z.height))
  pillars.forEach((p) => {
    const r = p.radiusUnits * scale
    grow(p.x - r, p.y - r, p.x + r, p.y + r)
  })

  const seats = []
  const geoms = tables.map((t) => {
    const g = getTableGeometry(t, scale)
    const rad = ((t.rotation || 0) * Math.PI) / 180
    const hw = g.width / 2 + 24
    const hh = g.height / 2 + 24
    const ex = Math.abs(hw * Math.cos(rad)) + Math.abs(hh * Math.sin(rad))
    const ey = Math.abs(hw * Math.sin(rad)) + Math.abs(hh * Math.cos(rad))
    grow(t.x - ex, t.y - ey, t.x + ex, t.y + ey)

    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const assigned = t.assignedGuestIds || []
    g.seats.forEach((s, i) => {
      const n = seatNormal(s, g)
      seats.push({
        x: t.x + s.x * cos - s.y * sin,
        y: t.y + s.x * sin + s.y * cos,
        nx: n.x * cos - n.y * sin,
        ny: n.x * sin + n.y * cos,
        index: i,
        table: t,
        guest: guests[assigned[i]] || null,
      })
    })
    return { t, g }
  })

  // An empty plan still needs a page to draw on.
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = roomW
    maxY = roomH
  }

  const pad = padPx ?? 32
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad

  return {
    scale,
    spaces,
    joins,
    zones,
    wallElements,
    pillars,
    geoms,
    seats,
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

/**
 * Measure a plan without drawing it: the bounds the sheet has to hold, the one
 * cell size every seat gets, and the type size that fits it. Split out from
 * buildFloorPlanSvg so the exporter can fit the page before anything is drawn,
 * then hand the same solved cells back in so the two cannot disagree.
 */
export function measureFloorPlan(doc, opts = {}) {
  const l = layoutFloorPlan(doc, opts)
  const measure = opts.measure || estimateWidth
  // `fit` maps the bounds a cell size produces to the scale the page would then
  // print at, so the solver can rank candidates by their size on paper.
  const rank = opts.fit
    ? (cell) => cell.basePx * opts.fit(expandForCells(l, cell))
    : undefined
  const cells = solveCells(l.seats, tokenWidthOf(l.seats, measure), rank)
  return { ...expandForCells(l, cells), ...cells }
}

// ── drawing ─────────────────────────────────────────────────────────────────

function renderNumberSeats(g, rot, withNumbers) {
  return g.seats
    .map((s, i) => {
      const circle = `<circle cx="${s.x}" cy="${s.y}" r="14" fill="#fff" stroke="#bbb" stroke-width="1.5"/>`
      const num = withNumbers
        ? `<text x="${s.x}" y="${s.y}" text-anchor="middle" dominant-baseline="middle"` +
          ` transform="rotate(${-rot} ${s.x} ${s.y})"` +
          ` font-size="9" font-weight="600" fill="#555">${i + 1}</text>`
        : ''
      return circle + num
    })
    .join('')
}

/**
 * Name cells, in world coordinates so they stay upright regardless of the
 * table's rotation — a rotated top table's names must still read normally.
 *
 * Every cell on the sheet is the same size and every name the same type size, so
 * the chart reads as one document. A name too wide for its cell wraps onto more
 * lines; only when it runs out of lines is it cut.
 */
function renderNameCells(seats, cellW, cellH, basePx, measure) {
  const r1 = (n) => Math.round(n * 10) / 10
  const textW = cellW - CELL_INSET * 2
  // Round DOWN to the precision actually written to the SVG, so the fit test
  // measures the same type the renderer will draw.
  const base = Math.floor(Math.min(basePx, cellH / (2 * LEADING)) * 10) / 10
  const budget = Math.max(2, Math.floor(cellH / (LEADING * base)))

  return seats
    .map((s) => {
      const c = cellCentre(s, outwardOf(s), cellH)
      const x = r1(c.x - cellW / 2)
      const y = r1(c.y - cellH / 2)
      const box = `<rect x="${x}" y="${y}" width="${r1(cellW)}" height="${r1(cellH)}" rx="2"`
      if (!s.guest) {
        return `${box} fill="#fff" fill-opacity="0.6" stroke="#ddd" stroke-width="0.75" stroke-dasharray="3 2"/>`
      }

      const first = s.guest.firstName || s.guest.fullName || ''
      const last = s.guest.lastName || ''
      const styled = (tokens, weight, fill) => tokens.map((t) => ({ t, weight, fill }))
      let lines = [
        ...styled(wrapToken(first, base, textW, measure), 700, '#1f1b16'),
        ...styled(wrapToken(last, base, textW, measure), 400, '#4a4238'),
      ].filter((l) => l.t !== '')

      // Splitting a hyphenated surname only pays if the cell has the line to spare.
      // Where it does not, one line per name and a cut surname keeps more of it:
      // "Gadd-Chap…" tells you more than "Gadd-" does.
      if (lines.length > budget) {
        lines = [
          ...styled([first], 700, '#1f1b16'),
          ...styled([last], 400, '#4a4238'),
        ].filter((l) => l.t !== '')
      }
      // Still over budget only when a guest has no surname to drop; cut the rest.
      if (lines.length > budget) lines.length = budget

      const top = c.y - (lines.length * LEADING * base) / 2 + base * 0.85
      return (
        `${box} fill="#fff" stroke="#c9c2b6" stroke-width="0.75"/>` +
        lines
          .map(
            (l, i) =>
              `<text x="${r1(c.x)}" y="${r1(top + i * LEADING * base)}" text-anchor="middle"` +
              ` font-size="${base}" font-weight="${l.weight}" fill="${l.fill}">` +
              `${escAttr(fitToken(l.t, base, textW, measure))}</text>`
          )
          .join('')
      )
    })
    .join('')
}

export function buildFloorPlanSvg(doc, opts = {}) {
  const {
    showSeats = true,
    seatLabels = 'number',
    nameFontPx,
    measure = estimateWidth,
    window: win,
  } = opts
  const l = layoutFloorPlan(doc, opts)
  const { scale, spaces, joins, zones, wallElements, pillars, geoms, seats } = l

  const parts = []
  // Floor spaces (rectangles + polygons).
  spaces.forEach((sp) => {
    const fill = sp.backgroundColour || '#FAF8F5'
    if (sp.shape === 'polygon') {
      const pts = sp.vertices.map((v) => `${sp.x + v.x},${sp.y + v.y}`).join(' ')
      parts.push(`<polygon points="${pts}" fill="${fill}" stroke="#7c6f5b" stroke-width="2.5"/>`)
    } else {
      parts.push(
        `<rect x="${sp.x}" y="${sp.y}" width="${sp.width}" height="${sp.height}" rx="14" fill="${fill}" stroke="#7c6f5b" stroke-width="2.5"/>`
      )
    }
  })
  // Join bridges: cover touching borders so joined spaces read as one floor.
  joins.forEach((j) => {
    const a = spaces.find((s) => s.id === j.a)
    const b = spaces.find((s) => s.id === j.b)
    if (!a || !b) return
    const ba = spaceBox(a)
    const bb = spaceBox(b)
    const x1 = Math.max(ba.minX, bb.minX) - 2
    const y1 = Math.max(ba.minY, bb.minY) - 2
    const x2 = Math.min(ba.maxX, bb.maxX) + 2
    const y2 = Math.min(ba.maxY, bb.maxY) + 2
    if (x2 > x1 && y2 > y1) {
      parts.push(
        `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${a.backgroundColour || '#FAF8F5'}"/>`
      )
    }
  })
  zones.forEach((z) => {
    const fill = z.colour || '#E8E0D5'
    if (z.shape === 'circle') {
      parts.push(
        `<ellipse cx="${z.x + z.width / 2}" cy="${z.y + z.height / 2}" rx="${z.width / 2}" ry="${z.height / 2}" fill="${fill}" fill-opacity="0.55" stroke="#9e8e7a" stroke-width="1.5" stroke-dasharray="6 4"/>`
      )
    } else {
      parts.push(
        `<rect x="${z.x}" y="${z.y}" width="${z.width}" height="${z.height}" rx="10" fill="${fill}" fill-opacity="0.55" stroke="#9e8e7a" stroke-width="1.5" stroke-dasharray="6 4"/>`
      )
    }
    parts.push(`<text x="${z.x + 10}" y="${z.y + 20}" font-size="13" font-style="italic" fill="#6b5f52">${escAttr(z.label)}</text>`)
  })

  // Wall element gap overlays + symbols.
  const weBySpace = {}
  wallElements.forEach((we) => {
    if (!weBySpace[we.spaceId]) weBySpace[we.spaceId] = []
    weBySpace[we.spaceId].push(we)
  })
  spaces.forEach((sp) => {
    const elements = weBySpace[sp.id] || []
    if (!elements.length) return
    const segs = getWallSegs(sp)
    const fill = sp.backgroundColour || '#FAF8F5'
    elements.forEach((we) => {
      const seg = segs[we.wallIndex]
      if (!seg) return
      const segLen = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)
      if (!segLen) return
      const ux = (seg.x2 - seg.x1) / segLen
      const uy = (seg.y2 - seg.y1) / segLen
      const cx = seg.x1 + we.position * (seg.x2 - seg.x1)
      const cy = seg.y1 + we.position * (seg.y2 - seg.y1)
      const half = (we.widthUnits * scale) / 2
      const angleDeg = (Math.atan2(uy, ux) * 180) / Math.PI
      // Gap overlay
      parts.push(
        `<rect x="${-half}" y="-5" width="${half * 2}" height="10" fill="${fill}" transform="translate(${cx} ${cy}) rotate(${angleDeg})"/>`
      )
      if (we.type === 'opening') {
        // Perpendicular jamb marks
        const nx = -uy, ny = ux
        const JAMB = 6
        const jambA = { x: cx - half * ux, y: cy - half * uy }
        const jambB = { x: cx + half * ux, y: cy + half * uy }
        parts.push(
          `<line x1="${jambA.x - nx * JAMB}" y1="${jambA.y - ny * JAMB}" x2="${jambA.x + nx * JAMB}" y2="${jambA.y + ny * JAMB}" stroke="#7c6f5b" stroke-width="2"/>` +
          `<line x1="${jambB.x - nx * JAMB}" y1="${jambB.y - ny * JAMB}" x2="${jambB.x + nx * JAMB}" y2="${jambB.y + ny * JAMB}" stroke="#7c6f5b" stroke-width="2"/>`
        )
      } else if (we.type === 'door') {
        const d = buildDoorPath(we, seg, scale)
        if (d) parts.push(`<path d="${d}" fill="none" stroke="#7c6f5b" stroke-width="1.5"/>`)
      }
    })
  })

  // Pillars.
  pillars.forEach((p) => {
    const r = p.radiusUnits * scale
    parts.push(
      `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="#f0ece6" stroke="#7c6f5b" stroke-width="2"/>`
    )
  })

  const names = showSeats && seatLabels === 'name'
  // TODO(family-ux): this file never drew group/subgroup colour rings and
  // doesn't draw the new family ring either — the printed/exported floor
  // plan has no per-guest colour cues at all, only the table-level `t.colour`
  // tint below. The on-screen canvas fix doesn't cover this (this builds SVG
  // standalone, not a DOM screenshot). See tmp/family-ux-followups.md #5.
  geoms.forEach(({ t, g }) => {
    const rot = t.rotation || 0
    const tint = t.colour || '#ffffff'
    const opacity = t.colour ? 0.25 : 1
    const seatsSvg =
      showSeats && seatLabels === 'number'
        ? renderNumberSeats(g, rot, t.seatMode === 'seat')
        : ''
    parts.push(
      `<g transform="translate(${t.x} ${t.y}) rotate(${rot})">` +
        `<g fill="${tint}" fill-opacity="${opacity}" stroke="#999" stroke-width="1.5">${shapePath(g)}</g>` +
        seatsSvg +
        `</g>`
    )
    // Labels are drawn upright (outside the rotated group) so they stay readable.
    parts.push(
      `<text x="${t.x}" y="${t.y + 4}" text-anchor="middle" font-size="13" font-weight="${names ? 700 : 600}" fill="#333">${escAttr(t.label)}</text>`
    )
  })

  let bounds = { minX: l.minX, minY: l.minY, width: l.width, height: l.height }
  if (names) {
    // The exporter solves the cells once and passes them back in, so the sheet it
    // measured and the sheet it draws are the same sheet.
    const cells = opts.cells || solveCells(seats, tokenWidthOf(seats, measure))
    parts.push(renderNameCells(seats, cells.cellW, cells.cellH, nameFontPx || cells.basePx, measure))
    bounds = expandForCells(l, cells)
  }

  const vb = win || bounds
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vb.width}" height="${vb.height}" viewBox="${vb.minX} ${vb.minY} ${vb.width} ${vb.height}">` +
    parts.join('') +
    `</svg>`
  return { svg, width: vb.width, height: vb.height }
}
