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

const CELL_GAP = 6 // clear space (px) left between two adjacent name cells
const CELL_ASPECT = 0.52 // cell height as a fraction of its width
const MAX_CELL_W = 72
const MIN_CELL_W = 10
export const MIN_NAME_PX = 4.5 // below this, names get ellipsised rather than shrunk further

/** Fallback text metric when no real font metrics are supplied. Linear in size. */
const estimateWidth = (text, fontPx) => String(text).length * fontPx * 0.52

/**
 * Largest cell size for which no two seats' cells overlap.
 *
 * Two equally sized axis-aligned cells centred `dx`/`dy` apart overlap only if
 * `dx < w` AND `dy < h`, so a pair is safe for any `w <= max(dx, dy / ASPECT)`.
 * Take the minimum of that bound over every pair.
 *
 * ponytail: O(n²) over the seat list — ~100 seats on a real plan, so ~5k
 * distance checks. Swap in a grid/kd-tree only if plans ever reach thousands.
 */
function cellSizeFor(seats) {
  let bound = MAX_CELL_W + CELL_GAP
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      const dx = Math.abs(seats[i].x - seats[j].x)
      const dy = Math.abs(seats[i].y - seats[j].y)
      const safe = Math.max(dx, dy / CELL_ASPECT)
      if (safe < bound) bound = safe
    }
  }
  // The MIN_CELL_W clamp can in principle re-introduce an overlap on a plan
  // with seats stacked almost on top of each other; a readable cell beats an
  // invisible one there.
  const cellW = Math.max(MIN_CELL_W, Math.min(bound - CELL_GAP, MAX_CELL_W))
  return { cellW, cellH: cellW * CELL_ASPECT }
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
function layoutFloorPlan(doc, { ppu } = {}) {
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

  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
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
      seats.push({
        x: t.x + s.x * cos - s.y * sin,
        y: t.y + s.x * sin + s.y * cos,
        index: i,
        table: t,
        guest: guests[assigned[i]] || null,
      })
    })
    return { t, g }
  })

  const pad = 32
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
 * Measure a plan without drawing it: overall size in px plus the name-cell size
 * the seats can support. `nameTokens` is the widest name token per seated guest,
 * so a caller can pick a base type size off a percentile rather than the single
 * longest name on the plan.
 */
export function measureFloorPlan(doc, opts = {}) {
  const l = layoutFloorPlan(doc, opts)
  const { cellW, cellH } = cellSizeFor(l.seats)
  const nameTokens = []
  for (const s of l.seats) {
    if (!s.guest) continue
    const first = s.guest.firstName || s.guest.fullName || ''
    const last = s.guest.lastName || ''
    nameTokens.push(first.length >= last.length ? first : last)
  }
  return { minX: l.minX, minY: l.minY, width: l.width, height: l.height, cellW, cellH, nameTokens }
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
 */
function renderNameCells(seats, cellW, cellH, basePx, measure) {
  const r1 = (n) => Math.round(n * 10) / 10
  const textW = cellW - 4
  return seats
    .map((s) => {
      const x = r1(s.x - cellW / 2)
      const y = r1(s.y - cellH / 2)
      const box = `<rect x="${x}" y="${y}" width="${r1(cellW)}" height="${r1(cellH)}" rx="2"`
      if (!s.guest) {
        return `${box} fill="#fff" fill-opacity="0.6" stroke="#ddd" stroke-width="0.75" stroke-dasharray="3 2"/>`
      }
      const first = s.guest.firstName || s.guest.fullName || ''
      const last = s.guest.lastName || ''
      const base = Math.min(basePx, cellH / 2.1)
      // Each line is shrunk on its own, so one long surname costs only its own
      // line — not the given name above it, and not any other cell on the page.
      const sizeFor = (tok) => {
        const w = measure(tok, base)
        const f = w > textW ? Math.max(MIN_NAME_PX, (base * textW) / w) : base
        // Round DOWN to the precision actually written to the SVG, so the fit
        // test measures the same type the renderer will draw — otherwise a name
        // that just fits gets needlessly ellipsised.
        return Math.floor(f * 10) / 10
      }
      // Baselines are driven by `base`, not the per-line size, so names stay on
      // a common baseline across the whole sheet even where a line has shrunk.
      const line = (tok, dy, weight, fill) => {
        if (!tok) return ''
        const f = sizeFor(tok)
        return (
          `<text x="${r1(s.x)}" y="${r1(s.y + dy)}" text-anchor="middle" font-size="${f}"` +
          ` font-weight="${weight}" fill="${fill}">${escAttr(fitToken(tok, f, textW, measure))}</text>`
        )
      }
      return (
        `${box} fill="#fff" stroke="#c9c2b6" stroke-width="0.75"/>` +
        line(first, -0.225 * base, 700, '#1f1b16') +
        line(last, 0.925 * base, 400, '#4a4238')
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

  if (names) {
    const { cellW, cellH } = cellSizeFor(seats)
    const base = nameFontPx || Math.min(cellH / 2.1, 14)
    parts.push(renderNameCells(seats, cellW, cellH, base, measure))
  }

  const vb = win || { minX: l.minX, minY: l.minY, width: l.width, height: l.height }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vb.width}" height="${vb.height}" viewBox="${vb.minX} ${vb.minY} ${vb.width} ${vb.height}">` +
    parts.join('') +
    `</svg>`
  return { svg, width: vb.width, height: vb.height }
}
