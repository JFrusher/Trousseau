import { useState, useRef, useEffect, useCallback } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import clsx from 'clsx'
import { useStore } from '../../store/useStore.js'
import Icon from '../ui/Icon.jsx'
import GuestCard from './GuestCard.jsx'
import SubgroupBlock from './SubgroupBlock.jsx'
import FamilyBlock from './FamilyBlock.jsx'
import ContextMenu, { useContextMenu } from '../ui/ContextMenu.jsx'
import ColorPicker from '../ui/ColorPicker.jsx'
import { initials } from '../../utils/guestFilters.js'
import styles from './GroupBlock.module.css'

export default function GroupBlock({
  group,
  members,
  subgroups,
  families,
  selectedGuestId,
  selectedSet,
  onCardContextMenu,
}) {
  const renameGroup = useStore((s) => s.renameGroup)
  const recolourGroup = useStore((s) => s.recolourGroup)
  const dissolveGroup = useStore((s) => s.dissolveGroup)
  const createSubgroup = useStore((s) => s.createSubgroup)
  const createFamily = useStore((s) => s.createFamily)
  const setSelectedGuestIds = useStore((s) => s.setSelectedGuestIds)
  const openModal = useStore((s) => s.openModal)
  const showColours = useStore((s) => s.settings.showGroupColours)

  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const [recolouring, setRecolouring] = useState(false)
  const inputRef = useRef(null)
  const { menu, openAt, close } = useContextMenu()

  const { listeners, attributes, setNodeRef: setDragRef, setActivatorNodeRef, isDragging, active } =
    useDraggable({ id: `group_${group.id}`, data: { type: 'group', groupId: group.id } })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `group_drop_${group.id}`,
    data: { type: 'group', groupId: group.id },
  })

  const setRef = useCallback(
    (node) => {
      setDragRef(node)
      setDropRef(node)
    },
    [setDragRef, setDropRef]
  )

  const dragType = active?.data?.current?.type
  const canReceive =
    isOver &&
    (dragType === 'guest' ||
      (dragType === 'group' && active?.data?.current?.groupId !== group.id))

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const memberCount = group.memberIds?.length || 0
  const swatchColour = showColours ? group.colour : 'rgba(231,229,228,0.3)'

  const commitName = () => {
    const v = draft.trim()
    if (v && v !== group.name) renameGroup(group.id, v)
    setEditing(false)
  }

  const startRename = () => {
    setDraft(group.name)
    setEditing(true)
  }

  const menuItems = [
    { label: 'Rename', icon: 'edit', onClick: startRename },
    { label: 'Recolour', icon: 'square', onClick: () => setRecolouring((v) => !v) },
    { label: 'Select all', icon: 'users', onClick: () => setSelectedGuestIds(group.memberIds) },
    { label: 'New subgroup', icon: 'plus', onClick: () => createSubgroup(group.id) },
    {
      label: 'New family',
      icon: 'link',
      onClick: () => createFamily({ parentGroupId: group.id }),
    },
    { separator: true },
    {
      label: 'Dissolve group',
      icon: 'trash',
      danger: true,
      onClick: () =>
        openModal('confirm', {
          title: 'Dissolve group?',
          message: `"${group.name}" will be removed. Its ${memberCount} guests stay in your list.`,
          confirmLabel: 'Dissolve',
          danger: true,
          onConfirm: () => dissolveGroup(group.id),
        }),
    },
  ]

  return (
    <div ref={setRef} className={clsx(styles.group, isDragging && styles.dragging, canReceive && styles.dropTarget)}>
      <div className={styles.header} onContextMenu={openAt}>
        <button
          ref={setActivatorNodeRef}
          type="button"
          className={styles.handle}
          aria-label={`Drag group ${group.name}`}
          {...listeners}
          {...attributes}
        >
          <Icon name="grip" size={14} />
        </button>
        <span className={styles.swatch} style={{ background: swatchColour }} />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <Icon
            name={collapsed ? 'chevron-right' : 'chevron-down'}
            size={14}
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
            <span className={styles.name} onDoubleClick={startRename}>
              {group.name}
            </span>
          )}
        </button>
        <span className={styles.count}>{memberCount}</span>
      </div>

      {recolouring && (
        <div className={styles.recolour}>
          <ColorPicker
            value={group.colour}
            onChange={(c) => {
              recolourGroup(group.id, c)
              setRecolouring(false)
            }}
          />
        </div>
      )}

      {collapsed ? (
        <div
          className={styles.avatars}
          onClick={() => setCollapsed(false)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setCollapsed(false)}
        >
          {/* Show avatars for all members (direct + subgroup + family) */}
          {[
            ...members,
            ...(subgroups || []).flatMap((sg) => sg.members),
            ...(families || []).flatMap((f) => f.members),
          ]
            .slice(0, 9)
            .map((g) => (
              <span
                key={g.id}
                className={clsx(styles.avatar, g.assignedTableId && styles.avatarAssigned)}
                title={g.fullName}
              >
                {initials(g.fullName)}
              </span>
            ))}
          {memberCount > 9 && (
            <span className={styles.avatarMore}>+{memberCount - 9}</span>
          )}
        </div>
      ) : (
        <div className={styles.members}>
          {/* Subgroups first, then families attached directly to this group, then
              direct (ungrouped-into-subgroup-or-family) members */}
          {(subgroups || []).map(({ subgroup, members: sgMembers, families: sgFamilies }) => (
            <SubgroupBlock
              key={subgroup.id}
              subgroup={subgroup}
              members={sgMembers}
              families={sgFamilies}
              selectedGuestId={selectedGuestId}
              selectedSet={selectedSet}
              onCardContextMenu={onCardContextMenu}
            />
          ))}
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
          {members.length === 0 && (subgroups || []).length === 0 && (families || []).length === 0 ? (
            <p className={styles.emptyHint}>
              Empty group. Assign guests via a guest&rsquo;s Group menu in the inspector.
            </p>
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
