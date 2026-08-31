import { useState, useRef, useEffect, useCallback } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import clsx from 'clsx'
import { useStore } from '../../store/useStore.js'
import Icon from '../ui/Icon.jsx'
import GuestCard from './GuestCard.jsx'
import ContextMenu, { useContextMenu } from '../ui/ContextMenu.jsx'
import ColorPicker from '../ui/ColorPicker.jsx'
import styles from './FamilyBlock.module.css'

export default function FamilyBlock({
  family,
  members,
  selectedGuestId,
  selectedSet,
  onCardContextMenu,
}) {
  const renameFamily = useStore((s) => s.renameFamily)
  const recolourFamily = useStore((s) => s.recolourFamily)
  const dissolveFamily = useStore((s) => s.dissolveFamily)
  const openModal = useStore((s) => s.openModal)
  const showColours = useStore((s) => s.settings.showGroupColours)

  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(family.name)
  const [recolouring, setRecolouring] = useState(false)
  const inputRef = useRef(null)
  const { menu, openAt, close } = useContextMenu()

  const {
    listeners,
    attributes,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    isDragging,
    active,
  } = useDraggable({
    id: `family_${family.id}`,
    data: {
      type: 'family',
      familyId: family.id,
      parentGroupId: family.parentGroupId,
      parentSubgroupId: family.parentSubgroupId,
    },
  })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `family_drop_${family.id}`,
    data: {
      type: 'family',
      familyId: family.id,
      parentGroupId: family.parentGroupId,
      parentSubgroupId: family.parentSubgroupId,
    },
  })

  const setRef = useCallback(
    (node) => {
      setDragRef(node)
      setDropRef(node)
    },
    [setDragRef, setDropRef]
  )

  const canReceive = isOver && active?.data?.current?.type === 'guest'

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // TODO(family-ux): rename didn't visibly take effect in an automated
  // dblclick+type+Enter test — code here is a 1:1 copy of Group/SubgroupBlock's
  // already-working rename, so this is more likely a test-harness targeting
  // issue than a real bug, but never manually confirmed in a live session.
  // See tmp/family-ux-followups.md #10.
  const commitName = () => {
    const v = draft.trim()
    if (v && v !== family.name) renameFamily(family.id, v)
    setEditing(false)
  }

  const menuItems = [
    { label: 'Rename', icon: 'edit', onClick: () => setEditing(true) },
    { label: 'Recolour', icon: 'square', onClick: () => setRecolouring((v) => !v) },
    { separator: true },
    {
      label: 'Dissolve family',
      icon: 'trash',
      danger: true,
      onClick: () =>
        openModal('confirm', {
          title: 'Dissolve family?',
          message: `"${family.name}" will be removed. Its ${members.length} guests stay where they are.`,
          confirmLabel: 'Dissolve',
          danger: true,
          onConfirm: () => dissolveFamily(family.id),
        }),
    },
  ]

  return (
    <div
      ref={setRef}
      className={clsx(
        styles.family,
        isDragging && styles.dragging,
        canReceive && styles.dropTarget
      )}
    >
      <div className={styles.header} onContextMenu={openAt}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={styles.handle}
          aria-label={`Drag family ${family.name}`}
          {...listeners}
          {...attributes}
        >
          <Icon name="grip" size={12} />
        </button>
        <span
          className={styles.swatch}
          style={{ background: showColours ? family.colour : 'rgba(231,229,228,0.25)' }}
        />
        <Icon name="link" size={11} className={styles.familyIcon} />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <Icon
            name={collapsed ? 'chevron-right' : 'chevron-down'}
            size={12}
            className={styles.chevron}
          />
          {editing ? (
            <input
              ref={inputRef}
              className={styles.nameInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitName}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <span className={styles.name} onDoubleClick={() => setEditing(true)}>
              {family.name}
            </span>
          )}
        </button>
        <span className={styles.count}>{members.length}</span>
      </div>

      {recolouring && (
        <div className={styles.recolour}>
          <ColorPicker
            value={family.colour}
            onChange={(c) => {
              recolourFamily(family.id, c)
              setRecolouring(false)
            }}
          />
        </div>
      )}

      {!collapsed && (
        <div className={styles.members}>
          {members.length === 0 ? (
            <p className={styles.emptyHint}>Drag guests here to add them to this family.</p>
          ) : (
            members.map((g) => (
              <GuestCard
                key={g.id}
                guest={g}
                selected={selectedGuestId === g.id}
                multiSelected={selectedSet.has(g.id)}
                onContextMenu={(e) => onCardContextMenu(g.id, e)}
              />
            ))
          )}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={close} />}
    </div>
  )
}
