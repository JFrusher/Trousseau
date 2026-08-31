import { useState, useRef, useCallback } from 'react'
import { useStore } from '../../store/useStore.js'
import { DEFAULT_PPU } from '../../utils/seatPositions.js'
import { CM_PER_FOOT } from '../../utils/units.js'
import ContextMenu, { useContextMenu } from '../ui/ContextMenu.jsx'
import ColorPicker from '../ui/ColorPicker.jsx'
import Icon from '../ui/Icon.jsx'
import styles from './RoomSpaces.module.css'

/** Bounding box of a space in absolute canvas coords. */
function bbox(sp) {
  if (sp.shape === 'polygon') {
    const xs = sp.vertices.map((v) => sp.x + v.x)
    const ys = sp.vertices.map((v) => sp.y + v.y)
    return {
      minX: Math.min(...xs, sp.x),
      minY: Math.min(...ys, sp.y),
      maxX: Math.max(...xs, sp.x),
      maxY: Math.max(...ys, sp.y),
    }
  }
  return { minX: sp.x, minY: sp.y, maxX: sp.x + sp.width, maxY: sp.y + sp.height }
}

const polyPoints = (sp) => sp.vertices.map((v) => `${sp.x + v.x},${sp.y + v.y}`).join(' ')

/** Wall segments for a space (each with wallIndex + absolute canvas coords). */
function getWallSegments(sp) {
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

/** Closest point on segment + normalised t (0-1) + pixel distance. */
function nearestOnSegment(p, seg) {
  const dx = seg.x2 - seg.x1
  const dy = seg.y2 - seg.y1
  const len2 = dx * dx + dy * dy || 1
  let t = ((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = seg.x1 + t * dx
  const cy = seg.y1 + t * dy
  return { dist: Math.hypot(p.x - cx, p.y - cy), t }
}

/** Compute the door SVG path string for a wall element. */
function doorPath(we, seg, ppu) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)
  if (!len) return ''
  const ux = (seg.x2 - seg.x1) / len
  const uy = (seg.y2 - seg.y1) / len
  const cx = seg.x1 + we.position * (seg.x2 - seg.x1)
  const cy = seg.y1 + we.position * (seg.y2 - seg.y1)
  const half = (we.widthUnits * ppu) / 2

  const jambA = { x: cx - half * ux, y: cy - half * uy }
  const jambB = { x: cx + half * ux, y: cy + half * uy }
  const hinge = we.swingSide === 'left' ? jambA : jambB
  const free = we.swingSide === 'left' ? jambB : jambA

  // Inward normal: 90° CW rotation of wall direction (-uy, ux).
  const normalDir = we.swingInward ? 1 : -1
  const doorLen = half * 2
  const openPos = { x: hinge.x + doorLen * -uy * normalDir, y: hinge.y + doorLen * ux * normalDir }

  // Sweep flag via cross product of (free-hinge) × (openPos-hinge).
  const fhx = free.x - hinge.x, fhy = free.y - hinge.y
  const ohx = openPos.x - hinge.x, ohy = openPos.y - hinge.y
  const sweep = fhx * ohy - fhy * ohx > 0 ? 1 : 0

  const r = (n) => Math.round(n * 10) / 10
  return (
    `M ${r(hinge.x)} ${r(hinge.y)} L ${r(openPos.x)} ${r(openPos.y)} ` +
    `M ${r(free.x)} ${r(free.y)} A ${r(doorLen)} ${r(doorLen)} 0 0 ${sweep} ${r(openPos.x)} ${r(openPos.y)}`
  )
}

/**
 * Renders all floor spaces (rectangles + polygons) and their joins as one SVG,
 * with HTML overlays for selection handles, rename and recolour. Also renders
 * wall elements (doors, openings) and pillars.
 */
export default function RoomSpaces({ screenToCanvas, dashed }) {
  const room = useStore((s) => s.room)
  const ppu = useStore((s) => s.settings.pixelsPerUnit || DEFAULT_PPU)
  const unitSystem = useStore((s) => s.settings.unitSystem || 'metric')
  const gridSnap = useStore((s) => s.settings.gridSnap)
  const gridSize = useStore((s) => s.settings.gridSize || 20)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const dispatch = useStore((s) => s.dispatch)
  const updateRoom = useStore((s) => s.updateRoom)
  const removeSpace = useStore((s) => s.removeSpace)
  const renameSpace = useStore((s) => s.renameSpace)
  const recolourSpace = useStore((s) => s.recolourSpace)
  const joinSpaces = useStore((s) => s.joinSpaces)
  const patchEntityLive = useStore((s) => s.patchEntityLive)
  const activeTool = useStore((s) => s.activeTool)
  const setActiveTool = useStore((s) => s.setActiveTool)
  const wallElements = useStore((s) => s.wallElements || {})
  const pillars = useStore((s) => s.pillars || {})
  const addWallElement = useStore((s) => s.addWallElement)
  const removeWallElement = useStore((s) => s.removeWallElement)
  const updateWallElement = useStore((s) => s.updateWallElement)
  const removePillar = useStore((s) => s.removePillar)

  const { menu, openAt, close: closeMenu } = useContextMenu()
  const [menuTarget, setMenuTarget] = useState(null) // { type: 'space'|'we'|'pillar', id }
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [recolouring, setRecolouring] = useState(null)
  const inputRef = useRef(null)
  const movedRef = useRef(false)

  const spaces = room.spaces || []
  const joins = room.joins || []
  const selectedId = selection.type === 'space' ? selection.id : null

  // SVG box big enough to contain everything (overflow visible covers the rest).
  let bw = 1
  let bh = 1
  spaces.forEach((sp) => {
    const b = bbox(sp)
    bw = Math.max(bw, b.maxX + 40)
    bh = Math.max(bh, b.maxY + 40)
  })

  const liveSpace = (id, patch) => {
    const r = useStore.getState().room
    updateRoom({ spaces: r.spaces.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }
  const commit = (orig) => {
    const r = useStore.getState().room
    dispatch({ type: 'EDIT_SPACE', label: 'Edit space', payload: { room: r }, inverse: { room: orig } })
  }
  const snap = (n) => (gridSnap ? Math.round(n / gridSize) * gridSize : Math.round(n))

  // Group wall elements by spaceId for efficient lookup.
  const weBySpace = {}
  Object.values(wallElements).forEach((we) => {
    if (!we) return
    if (!weBySpace[we.spaceId]) weBySpace[we.spaceId] = []
    weBySpace[we.spaceId].push(we)
  })

  // ── context menu ─────────────────────────────────────────────────────────────

  const openMenuFor = useCallback(
    (e, type, id) => {
      e.preventDefault()
      e.stopPropagation()
      setMenuTarget({ type, id })
      openAt(e)
    },
    [openAt]
  )

  const close = useCallback(() => {
    closeMenu()
    setMenuTarget(null)
  }, [closeMenu])

  const startRename = (sp) => {
    setDraft(sp.label)
    setEditing(sp.id)
    requestAnimationFrame(() => inputRef.current?.select())
  }
  const commitRename = (sp) => {
    const v = draft.trim()
    if (v) renameSpace(sp.id, { label: v })
    setEditing(null)
  }

  const spaceMenuItems = (sp) => {
    if (!sp) return []
    return [
      { label: 'Rename', icon: 'edit', onClick: () => startRename(sp) },
      { label: 'Recolour', icon: 'square', onClick: () => setRecolouring(sp.id) },
      ...spaces
        .filter((o) => o.id !== sp.id)
        .map((o) => {
          const joined = joins.some(
            (j) => (j.a === sp.id && j.b === o.id) || (j.a === o.id && j.b === sp.id)
          )
          return {
            label: `${joined ? 'Separate from' : 'Join with'} ${o.label}`,
            icon: 'maximize',
            onClick: () => joinSpaces(sp.id, o.id),
          }
        }),
      spaces.length > 1 && { separator: true },
      spaces.length > 1 && {
        label: 'Delete space',
        icon: 'trash',
        danger: true,
        onClick: () => removeSpace(sp.id),
      },
    ].filter(Boolean)
  }

  const weMenuItems = (we) => {
    if (!we) return []
    const items = []
    if (we.type === 'door') {
      items.push({
        label: we.swingInward ? 'Swing outward' : 'Swing inward',
        icon: 'rotate',
        onClick: () => updateWallElement(we.id, { swingInward: !we.swingInward }),
      })
      items.push({
        label: we.swingSide === 'left' ? 'Flip hinge to right' : 'Flip hinge to left',
        icon: 'rotate',
        onClick: () =>
          updateWallElement(we.id, { swingSide: we.swingSide === 'left' ? 'right' : 'left' }),
      })
      items.push({ separator: true })
    }
    items.push({ label: 'Delete', icon: 'trash', danger: true, onClick: () => removeWallElement(we.id) })
    return items
  }

  const menuItems = (() => {
    if (!menuTarget) return []
    if (menuTarget.type === 'space') return spaceMenuItems(spaces.find((s) => s.id === menuTarget.id))
    if (menuTarget.type === 'we') return weMenuItems(wallElements[menuTarget.id])
    if (menuTarget.type === 'pillar') {
      return [
        {
          label: 'Delete pillar',
          icon: 'trash',
          danger: true,
          onClick: () => removePillar(menuTarget.id),
        },
      ]
    }
    return []
  })()

  // ── space interaction ────────────────────────────────────────────────────────

  const selectSpace = (e, sp) => {
    if (e.button !== 0 || editing) return
    e.stopPropagation()
    select('space', sp.id)
  }

  // In door/opening mode: check if click is near a wall edge and place element there.
  const handleSpacePointerDown = (e, sp) => {
    if (activeTool === 'door' || activeTool === 'opening') {
      if (e.button !== 0) return
      const p = screenToCanvas(e.clientX, e.clientY)
      const segs = getWallSegments(sp)
      const THRESHOLD = 20
      let best = null
      for (const seg of segs) {
        const { dist, t } = nearestOnSegment(p, seg)
        if (dist < THRESHOLD && (best === null || dist < best.dist)) {
          best = { dist, t, wallIndex: seg.wallIndex }
        }
      }
      if (best !== null) {
        e.stopPropagation()
        addWallElement({
          spaceId: sp.id,
          wallIndex: best.wallIndex,
          position: best.t,
          type: activeTool,
          widthUnits: activeTool === 'door' ? 90 : 120,
          swingInward: true,
          swingSide: 'left',
        })
        setActiveTool('select')
      }
      return
    }
    selectSpace(e, sp)
  }

  const startMove = (e, sp) => {
    if (e.button !== 0 || editing) return
    e.preventDefault()
    e.stopPropagation()
    select('space', sp.id)
    const start = screenToCanvas(e.clientX, e.clientY)
    const orig = useStore.getState().room
    const o = orig.spaces.find((s) => s.id === sp.id)
    movedRef.current = false
    const onMove = (ev) => {
      const p = screenToCanvas(ev.clientX, ev.clientY)
      if (!movedRef.current && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 2) {
        movedRef.current = true
      }
      liveSpace(sp.id, { x: snap(o.x + (p.x - start.x)), y: snap(o.y + (p.y - start.y)) })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (movedRef.current) commit(orig)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startResize = (e, sp) => {
    e.preventDefault()
    e.stopPropagation()
    const orig = useStore.getState().room
    const onMove = (ev) => {
      const p = screenToCanvas(ev.clientX, ev.clientY)
      liveSpace(sp.id, {
        width: Math.max(80, snap(p.x - sp.x)),
        height: Math.max(80, snap(p.y - sp.y)),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      commit(orig)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startVertexDrag = (e, sp, index) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const orig = useStore.getState().room
    const onMove = (ev) => {
      const p = screenToCanvas(ev.clientX, ev.clientY)
      const o = useStore.getState().room.spaces.find((s) => s.id === sp.id)
      const vertices = o.vertices.map((v, i) =>
        i === index ? { x: snap(p.x - o.x), y: snap(p.y - o.y) } : v
      )
      liveSpace(sp.id, { vertices })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      commit(orig)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const deleteVertex = (sp, index) => {
    if (sp.vertices.length <= 3) return
    const orig = useStore.getState().room
    liveSpace(sp.id, { vertices: sp.vertices.filter((_, i) => i !== index) })
    commit(orig)
  }

  const insertVertex = (e, sp) => {
    if (sp.shape !== 'polygon') return
    e.stopPropagation()
    const p = screenToCanvas(e.clientX, e.clientY)
    const local = { x: p.x - sp.x, y: p.y - sp.y }
    const vs = sp.vertices
    let best = { i: 0, d: Infinity }
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i]
      const b = vs[(i + 1) % vs.length]
      const d = distToSegment(local, a, b)
      if (d < best.d) best = { i, d }
    }
    const orig = useStore.getState().room
    const next = [...vs]
    next.splice(best.i + 1, 0, { x: Math.round(local.x), y: Math.round(local.y) })
    liveSpace(sp.id, { vertices: next })
    commit(orig)
  }

  // ── pillar drag ──────────────────────────────────────────────────────────────

  const startPillarDrag = (e, pillar) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const start = screenToCanvas(e.clientX, e.clientY)
    const orig = { ...pillar }
    let moved = false
    const onMove = (ev) => {
      const p = screenToCanvas(ev.clientX, ev.clientY)
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > 2) moved = true
      patchEntityLive('pillars', pillar.id, {
        x: snap(orig.x + (p.x - start.x)),
        y: snap(orig.y + (p.y - start.y)),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) {
        const fp = useStore.getState().pillars[pillar.id]
        dispatch({
          type: 'MOVE_PILLAR',
          label: 'Move pillar',
          payload: { pillars: { [pillar.id]: fp } },
          inverse: { pillars: { [pillar.id]: orig } },
        })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Scale bar.
  const stepCm = unitSystem === 'imperial' ? CM_PER_FOOT * 3 : 100
  const stepPx = stepCm * ppu
  const stepLabel = unitSystem === 'imperial' ? '3 ft' : '1 m'
  const primary = spaces[0]

  return (
    <>
      <svg className={styles.svg} width={bw} height={bh} data-room-svg>
        {/* Join bridges */}
        {joins.map((j, i) => {
          const a = spaces.find((s) => s.id === j.a)
          const b = spaces.find((s) => s.id === j.b)
          if (!a || !b) return null
          const ba = bbox(a)
          const bb = bbox(b)
          const x1 = Math.max(ba.minX, bb.minX) - 2
          const y1 = Math.max(ba.minY, bb.minY) - 2
          const x2 = Math.min(ba.maxX, bb.maxX) + 2
          const y2 = Math.min(ba.maxY, bb.maxY) + 2
          if (x2 <= x1 || y2 <= y1) return null
          return (
            <rect key={`join_${i}`} x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill={a.backgroundColour} />
          )
        })}

        {/* Spaces */}
        {spaces.map((sp) => {
          const selected = sp.id === selectedId
          const common = {
            fill: sp.backgroundColour,
            stroke: selected ? 'var(--ink)' : dashed ? 'var(--accent-hover)' : 'var(--accent)',
            strokeWidth: selected ? 3 : 2,
            strokeDasharray: dashed ? '8 6' : undefined,
            'data-canvas-item': '',
            className: styles.space,
            onPointerDown: (e) => handleSpacePointerDown(e, sp),
            onDoubleClick: (e) =>
              sp.shape === 'polygon' ? insertVertex(e, sp) : (e.stopPropagation(), startRename(sp)),
            onContextMenu: (e) => {
              select('space', sp.id)
              openMenuFor(e, 'space', sp.id)
            },
          }
          return sp.shape === 'polygon' ? (
            <polygon key={sp.id} points={polyPoints(sp)} {...common} />
          ) : (
            <rect key={sp.id} x={sp.x} y={sp.y} width={sp.width} height={sp.height} rx={10} {...common} />
          )
        })}

        {/* Wall element gap overlays — fill over the stroke to cut a gap. */}
        {spaces.flatMap((sp) => {
          const elements = weBySpace[sp.id] || []
          if (!elements.length) return []
          const segs = getWallSegments(sp)
          return elements.map((we) => {
            const seg = segs[we.wallIndex]
            if (!seg) return null
            const segLen = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)
            if (!segLen) return null
            const ux = (seg.x2 - seg.x1) / segLen
            const uy = (seg.y2 - seg.y1) / segLen
            const cx = seg.x1 + we.position * (seg.x2 - seg.x1)
            const cy = seg.y1 + we.position * (seg.y2 - seg.y1)
            const half = (we.widthUnits * ppu) / 2
            const angleDeg = (Math.atan2(uy, ux) * 180) / Math.PI
            // Gap rectangle: covers the stroke (10px tall = generous over stroke-width 2-3).
            return (
              <rect
                key={`gap_${we.id}`}
                x={-half}
                y={-5}
                width={half * 2}
                height={10}
                fill={sp.backgroundColour}
                transform={`translate(${cx} ${cy}) rotate(${angleDeg})`}
              />
            )
          })
        })}

        {/* Wall element symbols (door arc / opening jambs). */}
        {spaces.flatMap((sp) => {
          const elements = weBySpace[sp.id] || []
          if (!elements.length) return []
          const segs = getWallSegments(sp)
          return elements.map((we) => {
            const seg = segs[we.wallIndex]
            if (!seg) return null
            const segLen = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)
            if (!segLen) return null
            const ux = (seg.x2 - seg.x1) / segLen
            const uy = (seg.y2 - seg.y1) / segLen
            const cx = seg.x1 + we.position * (seg.x2 - seg.x1)
            const cy = seg.y1 + we.position * (seg.y2 - seg.y1)
            const half = (we.widthUnits * ppu) / 2
            const jambA = { x: cx - half * ux, y: cy - half * uy }
            const jambB = { x: cx + half * ux, y: cy + half * uy }
            const JAMB = 6

            const onCtx = (e) => openMenuFor(e, 'we', we.id)

            if (we.type === 'opening') {
              // Two short perpendicular jamb marks.
              const nx = -uy, ny = ux
              return (
                <g key={`sym_${we.id}`} className={styles.wallElement} onContextMenu={onCtx}>
                  <line x1={jambA.x - nx * JAMB} y1={jambA.y - ny * JAMB} x2={jambA.x + nx * JAMB} y2={jambA.y + ny * JAMB} stroke="var(--accent)" strokeWidth="2" />
                  <line x1={jambB.x - nx * JAMB} y1={jambB.y - ny * JAMB} x2={jambB.x + nx * JAMB} y2={jambB.y + ny * JAMB} stroke="var(--accent)" strokeWidth="2" />
                </g>
              )
            }

            if (we.type === 'door') {
              const d = doorPath(we, seg, ppu)
              return (
                <path
                  key={`sym_${we.id}`}
                  d={d}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                  className={styles.wallElement}
                  onContextMenu={onCtx}
                />
              )
            }

            return null
          })
        })}

        {/* Pillars */}
        {Object.values(pillars).filter(Boolean).map((pillar) => {
          const r = pillar.radiusUnits * ppu
          return (
            <circle
              key={pillar.id}
              cx={pillar.x}
              cy={pillar.y}
              r={r}
              fill="var(--surface-raised)"
              stroke="var(--accent)"
              strokeWidth="2"
              className={styles.pillar}
              data-canvas-item=""
              onPointerDown={(e) => startPillarDrag(e, pillar)}
              onContextMenu={(e) => openMenuFor(e, 'pillar', pillar.id)}
            />
          )
        })}

        {/* Vertex handles for selected polygon. */}
        {spaces
          .filter((sp) => sp.id === selectedId && sp.shape === 'polygon')
          .map((sp) =>
            sp.vertices.map((v, i) => (
              <circle
                key={`${sp.id}_v${i}`}
                cx={sp.x + v.x}
                cy={sp.y + v.y}
                r={6}
                className={styles.vertex}
                data-canvas-item=""
                onPointerDown={(e) => startVertexDrag(e, sp, i)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  deleteVertex(sp, i)
                }}
              />
            ))
          )}

        {/* Space labels */}
        {spaces.map((sp) => {
          const b = bbox(sp)
          return (
            <text key={`${sp.id}_label`} x={b.minX + 10} y={b.minY + 20} className={styles.label}>
              {sp.label}
            </text>
          )
        })}
      </svg>

      {/* Move grip for the selected space. */}
      {spaces
        .filter((sp) => sp.id === selectedId)
        .map((sp) => {
          const b = bbox(sp)
          return (
            <button
              key={`${sp.id}_move`}
              type="button"
              className={styles.moveHandle}
              style={{ left: b.minX, top: b.minY }}
              aria-label={`Move ${sp.label}`}
              title="Drag to move this space"
              onPointerDown={(e) => startMove(e, sp)}
              data-canvas-item=""
            >
              <Icon name="grip" size={14} />
            </button>
          )
        })}

      {/* Resize handle for selected rectangle space. */}
      {spaces
        .filter((sp) => sp.id === selectedId && sp.shape === 'rect')
        .map((sp) => (
          <button
            key={`${sp.id}_resize`}
            type="button"
            className={styles.handle}
            style={{ left: sp.x + sp.width, top: sp.y + sp.height }}
            aria-label="Resize space"
            onPointerDown={(e) => startResize(e, sp)}
            data-canvas-item=""
          />
        ))}

      {/* Inline rename input. */}
      {editing &&
        spaces
          .filter((sp) => sp.id === editing)
          .map((sp) => {
            const b = bbox(sp)
            return (
              <input
                key={`${sp.id}_rename`}
                ref={inputRef}
                className={styles.renameInput}
                style={{ left: b.minX + 8, top: b.minY + 6 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(sp)}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(sp)
                  if (e.key === 'Escape') setEditing(null)
                }}
                data-canvas-item=""
              />
            )
          })}

      {/* Recolour popover. */}
      {recolouring &&
        spaces
          .filter((sp) => sp.id === recolouring)
          .map((sp) => {
            const b = bbox(sp)
            return (
              <div
                key={`${sp.id}_colour`}
                className={styles.colourPop}
                style={{ left: b.minX + 8, top: b.minY + 28 }}
                data-canvas-item=""
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ColorPicker
                  value={sp.backgroundColour}
                  onChange={(c) => {
                    recolourSpace(sp.id, { backgroundColour: c })
                    setRecolouring(null)
                  }}
                />
              </div>
            )
          })}

      {/* Scale bar. */}
      {primary && (
        <div
          className={styles.scaleBar}
          style={{ left: primary.x + 12, top: bbox(primary).maxY - 18, width: stepPx }}
          aria-hidden="true"
        >
          <span className={styles.scaleLabel}>{stepLabel}</span>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={close} />}
    </>
  )
}

// Distance from point p to segment ab (for nearest-edge vertex insertion).
function distToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}
