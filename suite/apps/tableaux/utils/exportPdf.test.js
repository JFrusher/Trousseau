import { describe, expect, it } from 'vitest'
import { planSheets } from './exportPdf.js'

// A wide plan whose names are far too long to stay legible on one A4 sheet.
const tiny = { minX: 0, minY: 0, width: 4000, height: 1000, cellW: 30, cellH: 14 }
// A small plan that fits comfortably at full size.
const roomy = { minX: 0, minY: 0, width: 400, height: 300, cellW: 60, cellH: 30 }
const AVAIL_W = 746
const AVAIL_H = 547

describe('planSheets', () => {
  it('keeps one sheet when the type is legible', () => {
    expect(planSheets(roomy, 3, AVAIL_W, AVAIL_H, 'auto').windows).toHaveLength(1)
  })

  it('tiles automatically when one sheet would go below the font floor', () => {
    const { windows, basePt } = planSheets(tiny, 3, AVAIL_W, AVAIL_H, 'auto')
    expect(windows).toHaveLength(2)
    expect(basePt).toBeGreaterThan(planSheets(tiny, 3, AVAIL_W, AVAIL_H, 'single').basePt)
  })

  it('forces a single sheet even when the type is illegible', () => {
    expect(planSheets(tiny, 3, AVAIL_W, AVAIL_H, 'single').windows).toEqual([
      { minX: 0, minY: 0, width: 4000, height: 1000 },
    ])
  })

  it('forces two overlapping sheets even when one would do', () => {
    const { windows } = planSheets(roomy, 3, AVAIL_W, AVAIL_H, 'split')
    expect(windows).toHaveLength(2)
    // second tile starts before the halfway line, so the seam is covered
    expect(windows[1].minX).toBeLessThan(roomy.width / 2)
    expect(windows[0].minX + windows[0].width).toBeGreaterThan(windows[1].minX)
  })
})
