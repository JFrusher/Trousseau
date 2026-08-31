import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { readDoc, writeDoc } from '../store/sliceBridge.js'

/**
 * Loads the plan on mount and writes it back as it changes.
 *
 * This file used to be the largest piece of Tableaux's back end: a plan id, a
 * server revision, optimistic concurrency, a 409 handler that asked the user
 * which version should win, a localStorage crash backup, a `sendBeacon` on
 * unload and a retry when connectivity returned.
 *
 * None of it is gone — all of it moved. The shell stores the wedding on this
 * device, so there is no request to fail and nothing to back up against its
 * failure; it syncs end-to-end encrypted, so the version that wins is settled
 * by the conflict resolution shared with the other three tools rather than by
 * one tool's own dialogue; and its writes are debounced and flushed on unload,
 * which is what the beacon was for.
 *
 * What is left is the part that was always Tableaux's: read the document, and
 * write it back when it changes.
 */

/**
 * Kept because the toolbar and ⌘S call it, and because a manual save should
 * still say "saved". The write itself is immediate — there is no network — so
 * this is mostly about the status the user sees.
 */
export async function saveNow({ manual = false } = {}) {
  const s = useStore.getState()
  if (!s.loaded) return
  if (!manual && !s.isDirty()) return

  const revAtSave = s._rev
  s.setSaveStatus('saving')
  try {
    writeDoc(s.serialize())
    useStore.setState({
      save: { status: 'saved', lastSavedAt: new Date().toISOString(), lastSavedRev: revAtSave },
    })
  } catch {
    // A local write fails only if the browser is refusing storage outright. The
    // shell says so itself, in one place, rather than each tool having its own
    // version of that conversation.
    useStore.setState((st) => ({ save: { ...st.save, status: 'error' } }))
  }
}

/** Re-reads the plan from the shared wedding, discarding unsaved edits. */
export async function reloadPlan() {
  useStore.getState().hydrate(readDoc())
}

/**
 * Was a synchronous localStorage copy, written when a save had failed or a
 * session had expired — a second place to keep the work when the first one had
 * just proved unreliable. There is no unreliable first place any more, so the
 * honest translation of "make sure this is safe" is simply to save.
 */
export function writeBackup() {
  saveNow({ manual: true })
}

export function useAutoSave(intervalMs = 30000) {
  useEffect(() => {
    useStore.getState().hydrate(readDoc())

    const timer = setInterval(() => saveNow({ manual: false }), intervalMs)

    // The shared store debounces its own write and flushes it on unload, so
    // this only has to make sure the latest edit has reached it.
    const flush = () => saveNow({ manual: false })
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)

    return () => {
      clearInterval(timer)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
      // Standalone Tableaux was the page, so this only ran when the page was
      // going away and `beforeunload` had already covered it. It is a tab now,
      // and switching to Place cards unmounts it without the browser ever
      // firing an unload — which would silently drop up to a full interval of
      // work on the way out.
      flush()
    }
  }, [intervalMs])
}
