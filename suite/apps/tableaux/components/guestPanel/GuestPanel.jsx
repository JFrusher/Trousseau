import { useMemo, useState, useRef, useEffect } from 'react'
import { useStore } from '../../store/useStore.js'
import Icon from '../ui/Icon.jsx'
import IconButton from '../ui/IconButton.jsx'
import Button from '../ui/Button.jsx'
import GuestCard from './GuestCard.jsx'
import GroupBlock from './GroupBlock.jsx'
import FamilyBlock from './FamilyBlock.jsx'
import GuestSearch from './GuestSearch.jsx'
import ContextMenu from '../ui/ContextMenu.jsx'
import { matchesSearch, matchesFilters } from '../../utils/guestFilters.js'
import styles from './GuestPanel.module.css'

function WeddingName() {
  const name = useStore((s) => s.meta.weddingName)
  const updateMeta = useStore((s) => s.updateMeta)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    const v = draft.trim()
    if (v) updateMeta({ weddingName: v })
    else setDraft(name)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.nameInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(name)
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className={styles.name}
      onClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      title="Rename wedding"
    >
      {name}
    </button>
  )
}

export default function GuestPanel() {
  const guests = useStore((s) => s.guests)
  const groups = useStore((s) => s.groups)
  const subgroups = useStore((s) => s.subgroups)
  const families = useStore((s) => s.families)
  const search = useStore((s) => s.search)
  const filters = useStore((s) => s.filters)
  const selection = useStore((s) => s.selection)
  const selectedGuestIds = useStore((s) => s.selectedGuestIds)
  const select = useStore((s) => s.select)
  const createGroup = useStore((s) => s.createGroup)
  const createEmptyGroup = useStore((s) => s.createEmptyGroup)
  const createFamily = useStore((s) => s.createFamily)
  const clearSelection = useStore((s) => s.clearSelection)
  const removeFromGroup = useStore((s) => s.removeFromGroup)
  const removeFromFamily = useStore((s) => s.removeFromFamily)
  const unassignGuest = useStore((s) => s.unassignGuest)
  const removeGuest = useStore((s) => s.removeGuest)
  const removeGuests = useStore((s) => s.removeGuests)
  const openModal = useStore((s) => s.openModal)
  const addGuest = useStore((s) => s.addGuest)
  const togglePanel = useStore((s) => s.togglePanel)

  const [cardMenu, setCardMenu] = useState(null) // { x, y, guestId }

  // Create a blank guest and open it in the inspector for editing.
  const handleAddGuest = () => {
    openModal('confirm', {
      title: 'Add guest',
      message: 'Add a new guest to the list?',
      confirmLabel: 'Add guest',
      onConfirm: () => {
        const cmd = addGuest()
        if (cmd?.meta?.newGuestId) {
          select('guest', cmd.meta.newGuestId)
          if (!useStore.getState().panels.right) togglePanel('right')
        }
      },
    })
  }

  // Create an empty group; it appears in the list (and the inspector dropdown)
  // ready to receive guests.
  const handleNewGroup = () => createEmptyGroup()
  const handleNewFamily = () => createFamily()

  const { visibleGroups, standaloneFamilies, ungrouped, total, unassigned } = useMemo(() => {
    const list = Object.values(guests)
    const groupArr = Object.values(groups).sort((a, b) =>
      String(a.name).localeCompare(String(b.name))
    )
    const subgroupArr = Object.values(subgroups || {})
    const familyArr = Object.values(families || {})
    const showEmpty = !search && !filters.length

    const vGroups = groupArr
      .map((group) => {
        // TODO(family-ux): matchesSearch is only ever given the top-level
        // `group`, so searching a subgroup or family NAME doesn't surface its
        // members (only a personal-name match does) — a real gap for nested
        // families, which is how every family in the live plan is set up.
        // See tmp/family-ux-followups.md #2.
        const allMembers = (group.memberIds || [])
          .map((id) => guests[id])
          .filter(Boolean)
          .filter((g) => matchesSearch(g, group, search) && matchesFilters(g, filters))

        // Build subgroup sections: each subgroup with its matching members,
        // and any families nested inside that subgroup.
        const groupSubgroups = subgroupArr.filter((sg) => sg.parentGroupId === group.id)
        const sgIdSet = new Set(groupSubgroups.map((sg) => sg.id))
        const vSubgroups = groupSubgroups
          .map((sg) => {
            const sgAllMembers = allMembers.filter((m) => m.subgroupId === sg.id)
            const sgFamilies = familyArr.filter((f) => f.parentSubgroupId === sg.id)
            const famIdSet = new Set(sgFamilies.map((f) => f.id))
            const vFamilies = sgFamilies
              .map((f) => ({ family: f, members: sgAllMembers.filter((m) => m.familyId === f.id) }))
              .filter((vf) => vf.members.length > 0 || showEmpty)
            return {
              subgroup: sg,
              members: sgAllMembers.filter((m) => !m.familyId || !famIdSet.has(m.familyId)),
              families: vFamilies,
            }
          })
          .filter(
            (vs) =>
              vs.members.length > 0 ||
              vs.families.some((vf) => vf.members.length > 0) ||
              showEmpty
          )

        // Families attached directly to this group (not via one of its subgroups)
        const groupFamilies = familyArr.filter(
          (f) => f.parentGroupId === group.id && !f.parentSubgroupId
        )
        const gFamIdSet = new Set(groupFamilies.map((f) => f.id))
        const vGroupFamilies = groupFamilies
          .map((f) => ({ family: f, members: allMembers.filter((m) => m.familyId === f.id) }))
          .filter((vf) => vf.members.length > 0 || showEmpty)

        // Direct members: in the group, not in any of its subgroups, not in any
        // family attached directly to the group.
        const directMembers = allMembers.filter((m) => {
          if (m.subgroupId && sgIdSet.has(m.subgroupId)) return false
          if (m.familyId && gFamIdSet.has(m.familyId)) return false
          return true
        })

        return { group, members: directMembers, subgroups: vSubgroups, families: vGroupFamilies }
      })
      .filter(
        (vg) =>
          vg.members.length > 0 ||
          vg.subgroups.some(
            (vs) => vs.members.length > 0 || vs.families.some((vf) => vf.members.length > 0)
          ) ||
          vg.families.some((vf) => vf.members.length > 0) ||
          (!search && (vg.group.memberIds || []).length === 0)
      )

    // Families with no parent group/subgroup at all — stand on their own.
    const standalone = familyArr
      .filter((f) => !f.parentGroupId && !f.parentSubgroupId)
      .map((f) => ({
        family: f,
        members: (f.memberIds || [])
          .map((id) => guests[id])
          .filter(Boolean)
          .filter((g) => matchesSearch(g, f, search) && matchesFilters(g, filters)),
      }))
      .filter((vf) => vf.members.length > 0 || showEmpty)
      .sort((a, b) => String(a.family.name).localeCompare(String(b.family.name)))

    const ung = list
      .filter((g) => !g.groupId || !groups[g.groupId])
      .filter((g) => !g.familyId || !families[g.familyId])
      .filter((g) => matchesSearch(g, null, search) && matchesFilters(g, filters))
      .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)))

    return {
      visibleGroups: vGroups,
      standaloneFamilies: standalone,
      ungrouped: ung,
      total: list.length,
      unassigned: list.filter((g) => !g.assignedTableId).length,
    }
  }, [guests, groups, subgroups, families, search, filters])

  const selectedGuestId = selection.type === 'guest' ? selection.id : null
  const selectedSet = useMemo(() => new Set(selectedGuestIds), [selectedGuestIds])

  const onCardContextMenu = (guestId, e) => {
    e.preventDefault()
    e.stopPropagation()
    setCardMenu({ x: e.clientX, y: e.clientY, guestId })
  }

  const cardMenuItems = useMemo(() => {
    if (!cardMenu) return []
    const g = guests[cardMenu.guestId]
    if (!g) return []
    const multi = selectedGuestIds.length > 1 && selectedGuestIds.includes(g.id)
    return [
      { label: 'Edit details', icon: 'user', onClick: () => select('guest', g.id) },
      multi && {
        label: `Group ${selectedGuestIds.length} selected`,
        icon: 'users',
        onClick: () => {
          createGroup(selectedGuestIds)
          clearSelection()
        },
      },
      // TODO(family-ux): no equivalent bulk "Family N selected" quick action —
      // creating a family from a multi-select requires making an empty family
      // first, then drag-adding each selected guest individually.
      // See tmp/family-ux-followups.md #12.
      g.familyId && {
        label: 'Remove from family',
        icon: 'x',
        onClick: () => removeFromFamily(g.id),
      },
      g.groupId && {
        label: 'Remove from group',
        icon: 'x',
        onClick: () => removeFromGroup(g.id),
      },
      g.assignedTableId && {
        label: 'Unassign from table',
        icon: 'x',
        onClick: () => unassignGuest(g.id),
      },
      { separator: true },
      // Fixed 2026-08-08 (ux-audit #G18): these fired removeGuest/removeGuests
      // directly with no confirmation, inconsistent with the identical delete
      // in GuestInspector.jsx which does confirm. See tmp/ux-audit.md #G18.
      multi
        ? {
            label: `Delete ${selectedGuestIds.length} selected`,
            icon: 'trash',
            danger: true,
            onClick: () =>
              openModal('confirm', {
                title: 'Delete guests?',
                message: `${selectedGuestIds.length} guests will be permanently removed from the plan.`,
                confirmLabel: 'Delete guests',
                danger: true,
                onConfirm: () => {
                  removeGuests(selectedGuestIds)
                  clearSelection()
                },
              }),
          }
        : {
            label: 'Delete guest',
            icon: 'trash',
            danger: true,
            onClick: () =>
              openModal('confirm', {
                title: 'Delete guest?',
                message: `"${g.fullName}" will be permanently removed from the plan.`,
                confirmLabel: 'Delete guest',
                danger: true,
                onConfirm: () => removeGuest(g.id),
              }),
          },
    ].filter(Boolean)
  }, [
    cardMenu,
    guests,
    selectedGuestIds,
    select,
    createGroup,
    clearSelection,
    removeFromGroup,
    removeFromFamily,
    unassignGuest,
    removeGuest,
    removeGuests,
    openModal,
  ])

  const hasGuests = total > 0
  // Fixed 2026-08-08 (ux-audit #G1): standaloneFamilies was omitted here, so a
  // search matching only an ungrouped family showed "No guests match" directly
  // above the actual matching results. See tmp/ux-audit.md #G1.
  const noResults =
    hasGuests &&
    visibleGroups.length === 0 &&
    standaloneFamilies.length === 0 &&
    ungrouped.length === 0

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <WeddingName />
          <div className={styles.headerActions}>
            <IconButton icon="plus" label="Add guest" onDark onClick={handleAddGuest} />
            <IconButton
              icon="upload"
              label="Import guests"
              onDark
              onClick={() => openModal('import')}
            />
          </div>
        </div>
        <p className={styles.stats}>
          {total} {total === 1 ? 'guest' : 'guests'}
          {hasGuests && <span className={styles.dot}> · </span>}
          {hasGuests && <span>{unassigned} unassigned</span>}
        </p>
      </header>

      {hasGuests && <GuestSearch />}

      <div className={styles.scroll}>
        {/* TODO(ux-audit): !hasGuests is derived from `guests` (default {}
            before hydrate() runs) without gating on s.loaded, unlike
            RoomCanvas.jsx which correctly checks `loaded && !hasTables`. A
            returning user with guests already saved can briefly see this
            import prompt flash before hydration finishes. See
            tmp/ux-audit.md #A5. */}
        {!hasGuests && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <Icon name="users" size={28} />
            </div>
            <p className={styles.emptyTitle}>Start by importing your guest list</p>
            <Button variant="primary" icon="upload" onClick={() => openModal('import')}>
              Import CSV
            </Button>
            <p className={styles.emptyNote}>
              Have a Joy, Zola, or spreadsheet export? We&rsquo;ll help you map the columns.
            </p>
          </div>
        )}

        {noResults && (
          <p className={styles.noResults}>No guests match your search or filters.</p>
        )}

        {hasGuests && (
          <div className={styles.groupsBar}>
            <span className={styles.sectionLabel}>Groups</span>
            <button type="button" className={styles.newGroupBtn} onClick={handleNewGroup}>
              <Icon name="plus" size={12} /> New group
            </button>
          </div>
        )}

        {visibleGroups.length > 0 && (
          <section className={styles.section}>
            {visibleGroups.map(({ group, members, subgroups: vSubgroups, families: vFamilies }) => (
              <GroupBlock
                key={group.id}
                group={group}
                members={members}
                subgroups={vSubgroups}
                families={vFamilies}
                selectedGuestId={selectedGuestId}
                selectedSet={selectedSet}
                onCardContextMenu={onCardContextMenu}
              />
            ))}
          </section>
        )}

        {hasGuests && (
          <div className={styles.groupsBar}>
            <span className={styles.sectionLabel}>Families</span>
            <button type="button" className={styles.newGroupBtn} onClick={handleNewFamily}>
              <Icon name="plus" size={12} /> New family
            </button>
          </div>
        )}

        {standaloneFamilies.length > 0 && (
          <section className={styles.section}>
            {standaloneFamilies.map(({ family, members }) => (
              <FamilyBlock
                key={family.id}
                family={family}
                members={members}
                selectedGuestId={selectedGuestId}
                selectedSet={selectedSet}
                onCardContextMenu={onCardContextMenu}
              />
            ))}
          </section>
        )}

        {ungrouped.length > 0 && (
          <section className={styles.section}>
            {visibleGroups.length > 0 && <p className={styles.sectionLabel}>Other guests</p>}
            <div className={styles.flatList}>
              {ungrouped.map((g) => (
                <GuestCard
                  key={g.id}
                  guest={g}
                  selected={selectedGuestId === g.id}
                  multiSelected={selectedSet.has(g.id)}
                  onContextMenu={(e) => onCardContextMenu(g.id, e)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {cardMenu && (
        <ContextMenu
          x={cardMenu.x}
          y={cardMenu.y}
          items={cardMenuItems}
          onClose={() => setCardMenu(null)}
        />
      )}
    </div>
  )
}
