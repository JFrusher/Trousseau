import { useState, useRef, useEffect, useCallback } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import clsx from 'clsx'
import { useStore } from '../../store/useStore.js'
import Icon from '../ui/Icon.jsx'
import GuestCard from './GuestCard.jsx'
import FamilyBlock from './FamilyBlock.jsx'
import ContextMenu, { useContextMenu } from '../ui/ContextMenu.jsx'
import ColorPicker from '../ui/ColorPicker.jsx'
import styles from './SubgroupBlock.module.css'

export default function SubgroupBlock({
  subgroup,
  members,
  families,
  selectedGuestId,
  selectedSet,
  onCardContextMenu,
}) {
  const renameSubgroup = useStore((s) => s.renameSubgroup)
  const recolourSubgroup = useStore((s) => s.recolourSubgroup)
  const dissolveSubgroup = useStore((s) => s.dissolveSubgroup)
  const createFamily = useStore((s) => s.createFamily)
  const openModal = useStore((s) => s.openModal)
  const showColours = useStore((s) => s.settings.showGroupColours)

  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(subgroup.name)
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
    id: `subgroup_${subgroup.id}`,
    data: { type: 'subgroup', subgroupId: subgroup.id, parentGroupId: subgroup.parentGroupId },
  })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `subgroup_drop_${subgroup.id}`,
    data: { type: 'subgroup', subgroupId: subgroup.id, parentGroupId: subgroup.parentGroupId },
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

  const commitName = () => {
    const v = draft.trim()
    if (v && v !== subgroup.name) renameSubgroup(subgroup.id, v)
    setEditing(false)
  }

  const menuItems = [
    { label: 'Rename', icon: 'edit', onClick: () => setEditing(true) },
    { label: 'Recolour', icon: 'square', onClick: () => setRecolouring((v) => !v) },
    {
      label: 'New family',
      icon: 'link',
      onClick: () => createFamily({ parentSubgroupId: subgroup.id }),
    },
    { separator: true },
    {
      label: 'Dissolve subgroup',
      icon: 'trash',
      danger: true,
      onClick: () =>
        openModal('confirm', {
          title: 'Dissolve subgroup?',
          message: `"${subgroup.name}" will be removed. Its ${members.length} guests stay in the parent group.`,
          confirmLabel: 'Dissolve',
          danger: true,
          onConfirm: () => dissolveSubgroup(subgroup.id),
        }),
    },
  ]

  return (
    <div
      ref={setRef}
      className={clsx(
        styles.subgroup,
        isDragging && styles.dragging,
        canReceive && styles.dropTarget
      )}
    >
      <div className={styles.header} onContextMenu={openAt}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={styles.handle}
          aria-label={`Drag subgroup ${subgroup.name}`}
          {...listeners}
          {...attributes}
        >
          <Icon name="grip" size={12} />
        </button>
        <span
          className={styles.swatch}
          style={{ background: showColours ? subgroup.colour : 'rgba(231,229,228,0.25)' }}
        />
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
              {subgroup.name}
            </span>
          )}
        </button>
        <span className={styles.count}>{members.length}</span>
      </div>

      {recolouring && (
        <div className={styles.recolour}>
          <ColorPicker
            value={subgroup.colour}
            onChange={(c) => {
              recolourSubgroup(subgroup.id, c)
              setRecolouring(false)
            }}
          />
        </div>
      )}

      {!collapsed && (
        <div className={styles.members}>
          {(families || []).map(({ family, members: famMembers }) => (
            <FamilyBlock
              key={family.id}
              family={family}
              members={famMembers}
              selectedGuestId={selectedGuestId}
              selectedSet={selectedSet}
              onCardContextMenu={onCardContextMenu}
            />
          ))}
          {members.length === 0 && (families || []).length === 0 ? (
            <p className={styles.emptyHint}>Drag guests here to add them to this subgroup.</p>
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
