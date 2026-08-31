import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { exportFloorPlanPdf, exportCards } from '../../utils/exportPdf.js'
import { CARD_TEMPLATE_LIST } from '../../utils/cardTemplates.js'
import Modal from '../ui/Modal.jsx'
import Icon from '../ui/Icon.jsx'
import styles from './ExportModal.module.css'

const SHEET_OPTIONS = [
  {
    pages: 'single',
    label: 'Seating chart — one page (PDF)',
    desc: "Every guest's name printed on their seat, to scale on a single sheet.",
  },
  {
    pages: 'split',
    label: 'Seating chart — split over two sheets (PDF)',
    desc: 'Same chart at twice the size, tiled across two overlapping sheets.',
  },
]

export default function PrintModal() {
  const closeModal = useStore((s) => s.closeModal)
  const addToast = useStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)

  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    const s = useStore.getState()
    try {
      await fn(s.serialize(), s.meta.weddingName)
      closeModal()
    } catch (err) {
      addToast({ type: 'error', message: 'Could not generate the PDF. Please try again.' })
      // eslint-disable-next-line no-console
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Print &amp; PDF" size="sm" onClose={closeModal}>
      <div className={styles.options}>
        {SHEET_OPTIONS.map((o) => (
          <button
            key={o.pages}
            type="button"
            className={styles.option}
            disabled={busy}
            onClick={() => run((doc, name) => exportFloorPlanPdf(doc, name, { pages: o.pages }))}
          >
            <Icon name="maximize" size={20} className={styles.icon} />
            <span className={styles.label}>{o.label}</span>
            <span className={styles.desc}>{o.desc}</span>
          </button>
        ))}

        {CARD_TEMPLATE_LIST.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className={styles.option}
            disabled={busy}
            onClick={() => run((doc, name) => exportCards(doc, name, tpl.id))}
          >
            <Icon name="layers" size={20} className={styles.icon} />
            <span className={styles.label}>
              {tpl.kind === 'escort' ? 'Escort cards' : 'Place cards'} (PDF)
            </span>
            <span className={styles.desc}>{tpl.label}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
