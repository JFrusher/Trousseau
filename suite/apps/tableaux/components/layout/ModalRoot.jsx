import { useStore } from '../../store/useStore.js'
import ConfirmDialog from '../ui/ConfirmDialog.jsx'
import ImportModal from '../guestPanel/ImportModal.jsx'
import WarningsPanel from './WarningsPanel.jsx'
import ConstraintsModal from './ConstraintsModal.jsx'
import SnapshotsModal from './SnapshotsModal.jsx'
import ExportModal from './ExportModal.jsx'
import PlaqueExportModal from './PlaqueExportModal.jsx'
import SettingsModal from './SettingsModal.jsx'
import CalibrationModal from './CalibrationModal.jsx'
import CustomTableModal from './CustomTableModal.jsx'
import PrintModal from './PrintModal.jsx'

/**
 * Renders the single store-driven modal. New modal types are added to the
 * switch as their features are built (import, settings, snapshots, …).
 */
export default function ModalRoot() {
  const modal = useStore((s) => s.modal)
  const closeModal = useStore((s) => s.closeModal)

  if (!modal) return null
  const { name, props = {} } = modal

  switch (name) {
    case 'import':
      return <ImportModal />
    case 'warnings':
      return <WarningsPanel />
    case 'constraints':
      return <ConstraintsModal />
    case 'snapshots':
      return <SnapshotsModal />
    case 'export':
      return <ExportModal />
    case 'plaqueExport':
      return <PlaqueExportModal />
    case 'settings':
      return <SettingsModal />
    case 'calibrate':
      return <CalibrationModal {...props} />
    case 'customTable':
      return <CustomTableModal />
    case 'print':
      return <PrintModal />
    case 'confirm':
      // TODO(ux-audit): onConfirm is called without awaiting it, and the
      // dialog closes immediately unless keepOpen is set — but keepOpen is
      // never used anywhere in the codebase. The example that made this bite
      // was AccountModal's "Delete my account", which has since moved to the
      // shell; every remaining caller writes to this device and returns at
      // once, so the race is currently unreachable rather than fixed.
      // See tmp/ux-audit.md #A8.
      return (
        <ConfirmDialog
          {...props}
          onConfirm={() => {
            props.onConfirm?.()
            if (!props.keepOpen) closeModal()
          }}
          onCancel={() => {
            props.onCancel?.()
            closeModal()
          }}
        />
      )
    default:
      return null
  }
}
