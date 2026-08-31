import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import Modal from '../ui/Modal.jsx'
import Button from '../ui/Button.jsx'
import IconButton from '../ui/IconButton.jsx'
import f from '../sidebar/fields.module.css'
import styles from './SnapshotsModal.module.css'

const fmt = (iso) => {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Snapshots used to come in two kinds: rows in a server table when the plan had
 * an account behind it, and a list inside the document otherwise. Only the
 * second kind exists now — the plan lives on this device — so the server branch
 * and the `saas` flag that chose between them have gone rather than being left
 * as code that can no longer run.
 */
export default function SnapshotsModal() {
  const storeSnapshots = useStore((s) => s.snapshots)
  const saveSnapshot = useStore((s) => s.saveSnapshot)
  const restoreSnapshot = useStore((s) => s.restoreSnapshot)
  const deleteSnapshot = useStore((s) => s.deleteSnapshot)
  const openModal = useStore((s) => s.openModal)
  const closeModal = useStore((s) => s.closeModal)
  const addToast = useStore((s) => s.addToast)

  const [name, setName] = useState('')

  const snapshots = storeSnapshots
  const limit = 10
  const atLimit = snapshots.length >= limit

  const create = () => {
    saveSnapshot(name)
    addToast({ type: 'success', message: 'Snapshot saved.' })
    setName('')
  }

  // Fixed 2026-08-08 (ux-audit #M13): was missing danger:true, so this
  // plan-wiping action rendered with the normal button colour instead of the
  // red danger style every other destructive confirm in the app uses.
  // See tmp/ux-audit.md #M13 / #M15 (message still doesn't mention the
  // undo-stack also being cleared on restore — left as a follow-up).
  const restore = (snap) =>
    openModal('confirm', {
      title: 'Restore snapshot?',
      message: `This replaces your current plan with "${snap.name}".`,
      confirmLabel: 'Restore',
      danger: true,
      onConfirm: () => {
        restoreSnapshot(snap.id)
        addToast({ type: 'info', message: `Restored "${snap.name}".` })
        closeModal()
      },
    })

  // Fixed 2026-08-08 (ux-audit #M14): deleting a snapshot had no confirmation
  // at all — the only destructive action in the app that skipped ConfirmDialog.
  // See tmp/ux-audit.md #M14.
  const remove = (snap) =>
    openModal('confirm', {
      title: 'Delete snapshot?',
      message: `"${snap.name}" will be permanently deleted.`,
      confirmLabel: 'Delete snapshot',
      danger: true,
      onConfirm: () => deleteSnapshot(snap.id),
    })

  return (
    <Modal
      title="Snapshots"
      onClose={closeModal}
      footer={
        <Button variant="primary" onClick={closeModal}>
          Done
        </Button>
      }
    >
      <div className={styles.create}>
        <input
          className={f.input}
          placeholder="Name this snapshot, e.g. After Mum's edits"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !atLimit && create()}
          disabled={atLimit}
        />
        <Button variant="secondary" icon="camera" onClick={create} disabled={atLimit}>
          Save
        </Button>
      </div>
      {atLimit && (
        <p className={styles.limit}>
          You&rsquo;ve reached {limit} snapshots — delete one to add more.
        </p>
      )}

      {snapshots.length === 0 ? (
        <p className={styles.empty}>
          No snapshots yet. Save one before a big change so you can roll back.
        </p>
      ) : (
        <ul className={styles.list}>
          {snapshots.map((snap) => (
            <li key={snap.id} className={styles.row}>
              <div className={styles.info}>
                <span className={styles.name}>{snap.name}</span>
                <span className={styles.date}>{fmt(snap.savedAt || snap.created_at)}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => restore(snap)}>
                Restore
              </Button>
              <IconButton
                icon="trash"
                label="Delete snapshot"
                size={28}
                iconSize={14}
                onClick={() => remove(snap)}
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
