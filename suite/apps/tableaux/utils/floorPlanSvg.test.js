import { describe, it, expect } from 'vitest'
import { buildFloorPlanSvg, measureFloorPlan } from './floorPlanSvg.js'

// Two 8-seat trestles side by side plus a rotated 4-seat top table, matching the
// shape of a real plan: rect tables with seats on the long sides only.
const trestle = (id, label, x, y, extra = {}) => ({
  id,
  label,
  type: 'rect',
  x,
  y,
  rotation: 0,
  capacity: 8,
  seatMode: 'seat',
  perSideSeats: { top: 4, bottom: 4, left: 0, right: 0 },
  sizeUnits: { shape: 'rect', width: 365.76, height: 76.2 },
  assignedGuestIds: [],
  ...extra,
})

const guest = (id, firstName, lastName) => ({ id, firstName, lastName, fullName: `${firstName} ${lastName}` })

function makeDoc() {
  const guests = {}
  const ids = []
  const names = [
    ['Sam', 'Sparkes'],
    ['Jude', 'Silk'],
    ['Seren', 'Silk'],
    ['Emmanuel', 'Adu-Essah'],
    ['Elijah', 'Brown'],
    ['Katie', 'Sneddon'],
    ['Frankie', 'Hartland'],
    ['Jess', 'Mihaylova'],
    ['Ewan', 'Gadd-Chapman'],
    ['Georgina', 'Loveridge'],
    ['Kate', 'Seymour'],
    ['Lois', 'Steven'],
  ]
  names.forEach(([f, l], i) => {
    const id = `g${i}`
    guests[id] = guest(id, f, l)
    ids.push(id)
  })

  return {
    settings: { pixelsPerUnit: 0.7 },
    guests,
    tables: {
      t1: trestle('t1', 'Table 1', 140, 113, { assignedGuestIds: ids.slice(0, 8) }),
      // Deliberately short: seats 3 and 4 stay empty.
      t2: trestle('t2', 'Table 2', 396, 113, { assignedGuestIds: ids.slice(8, 10) }),
      t3: {
        ...trestle('t3', 'Table 3', 900, 300),
        type: 'top-table',
        rotation: 270,
        capacity: 2,
        perSideSeats: { top: 0, bottom: 2, left: 0, right: 0 },
        sizeUnits: { shape: 'rect', width: 300, height: 91.43 },
        assignedGuestIds: ids.slice(10, 12),
      },
    },
    // Sits at negative x, i.e. outside the room rect.
    zones: { z1: { id: 'z1', label: 'Stage', shape: 'rect', x: -103, y: 158, width: 103, height: 336 } },
    room: { spaces: [{ id: 'sp1', shape: 'rect', x: 0, y: 0, width: 1261, height: 629 }] },
  }
}

describe('measureFloorPlan', () => {
  it('includes zones that sit outside the room rect in the bounds', () => {
    const m = measureFloorPlan(makeDoc())
    expect(m.minX).toBeLessThanOrEqual(-103)
  })

  it('sizes name cells so no two overlap', () => {
    const doc = makeDoc()
    const m = measureFloorPlan(doc)
    expect(m.cellW).toBeGreaterThan(10)

    // Rebuild the world seat positions the same way the layout does.
    const cells = []
    const svg = buildFloorPlanSvg(doc, { seatLabels: 'name' }).svg
    const re = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="2"/g
    let mt
    while ((mt = re.exec(svg))) {
      cells.push({ x: +mt[1], y: +mt[2], w: +mt[3], h: +mt[4] })
    }
    expect(cells).toHaveLength(18) // 8 + 8 + 2 seats

    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]
        const b = cells[j]
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlaps, `cells ${i} and ${j} overlap`).toBe(false)
      }
    }
  })
})

describe('buildFloorPlanSvg seatLabels', () => {
  it('defaults to numbered seat circles (the on-screen / public view)', () => {
    const { svg } = buildFloorPlanSvg(makeDoc())
    expect(svg).toContain('r="14"')
    expect(svg).not.toContain('Sparkes')
    expect(svg).toMatch(/font-size="9" font-weight="600" fill="#555">1</)
  })

  it('renders first and last name on separate lines for each seated guest', () => {
    const { svg } = buildFloorPlanSvg(makeDoc(), { seatLabels: 'name' })
    for (const token of ['Sam', 'Sparkes', 'Emmanuel', 'Katie', 'Sneddon', 'Kate', 'Seymour']) {
      expect(svg).toContain(`>${token}<`)
    }
    // Seat numbers are gone from the chart.
    expect(svg).not.toContain('font-size="9" font-weight="600" fill="#555"')
  })

  it('shrinks only the line whose own token overflows', () => {
    const { svg } = buildFloorPlanSvg(makeDoc(), { seatLabels: 'name', nameFontPx: 12 })
    const sizeOf = (token) => {
      const m = new RegExp(`font-size="([\\d.]+)"[^>]*>${token}<`).exec(svg)
      return m ? +m[1] : null
    }
    expect(sizeOf('Silk')).toBe(12)
    expect(sizeOf('Gadd-Chapman')).toBeLessThan(12)
    // The long surname costs only its own line...
    expect(sizeOf('Ewan')).toBe(12)
    // ...and no other cell on the page.
    expect(sizeOf('Sparkes')).toBe(12)
  })

  it('keeps every name on a common baseline even where a line has shrunk', () => {
    const { svg } = buildFloorPlanSvg(makeDoc(), { seatLabels: 'name', nameFontPx: 12 })
    const yOf = (token) => {
      const m = new RegExp(`<text x="[-\\d.]+" y="([-\\d.]+)"[^>]*>${token}<`).exec(svg)
      return m ? +m[1] : null
    }
    // Gadd-Chapman and Sparkes both sit on a top edge, so their surname lines
    // must share a baseline despite one of them having been shrunk.
    expect(yOf('Gadd-Chapman')).toBe(yOf('Sparkes'))
    expect(yOf('Ewan')).toBe(yOf('Sam'))
  })

  it('draws unassigned seats as empty dashed cells', () => {
    const { svg } = buildFloorPlanSvg(makeDoc(), { seatLabels: 'name' })
    const dashed = svg.match(/stroke-dasharray="3 2"/g) || []
    expect(dashed).toHaveLength(6) // Table 2 has 8 seats, 2 filled
  })

  it('keeps names upright on a rotated table', () => {
    const { svg } = buildFloorPlanSvg(makeDoc(), { seatLabels: 'name' })
    const seymour = /<text x="[-\d.]+" y="[-\d.]+"[^>]*>Seymour</.exec(svg)
    expect(seymour).not.toBeNull()
    expect(seymour[0]).not.toContain('rotate')
  })
})
