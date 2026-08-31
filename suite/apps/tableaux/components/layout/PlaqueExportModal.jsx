import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import Modal from '../ui/Modal.jsx'
import Button from '../ui/Button.jsx'
import { exportPlaceCardsCsv, PLAQUE_EXPORT_DEFAULTS } from '../../utils/exportPlaque.js'
import styles from './PlaqueExportModal.module.css'

const FIELDS = [
  { key: 'dietary', label: 'Dietary' },
  { key: 'seat', label: 'Seat number' },
  { key: 'notes', label: 'Notes' },
  { key: 'side', label: "Wedding side (bride's/groom's)" },
  { key: 'family', label: 'Group / subgroup / family' },
]

export default function PlaqueExportModal() {
  const closeModal = useStore((s) => s.closeModal)
  const [options, setOptions] = useState(PLAQUE_EXPORT_DEFAULTS)

  const toggle = (key) => setOptions((o) => ({ ...o, [key]: !o[key] }))

  const download = () => {
    const s = useStore.getState()
    exportPlaceCardsCsv(s, s.meta.weddingName, options)
    closeModal()
  }

  return (
    <Modal
      title="Place cards (Plaque CSV)"
      size="sm"
      onClose={closeModal}
      footer={
        <Button variant="primary" icon="download" onClick={download}>
          Download CSV
        </Button>
      }
    >
      <p className={styles.intro}>
        A CSV of your seated guests, shaped to drop straight into Plaque for place
        cards — name and table bindings fill in automatically.
      </p>
      <div className={styles.fields}>
        {FIELDS.map((f) => (
          <label key={f.key} className={styles.checkRow}>
            <input
              type="checkbox"
              checked={options[f.key]}
              onChange={() => toggle(f.key)}
            />
            {f.label}
          </label>
        ))}
      </div>
    </Modal>
  )
}
