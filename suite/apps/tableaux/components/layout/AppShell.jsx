import clsx from 'clsx'
import { useStore } from '../../store/useStore.js'
import Toolbar from './Toolbar.jsx'
import GuestPanel from '../guestPanel/GuestPanel.jsx'
import RoomCanvas from '../canvas/RoomCanvas.jsx'
import RightSidebar from '../sidebar/RightSidebar.jsx'
import ErrorBoundary from '../ui/ErrorBoundary.jsx'
import styles from './AppShell.module.css'

// TODO(ux-audit): no reference to s.loaded anywhere in this component — the
// full shell (toolbar, panels, canvas) renders immediately regardless of
// load state, no spinner/skeleton for the initial plan fetch. Every reload
// briefly looks like a blank, brand-new account until reloadPlan()/hydrate()
// resolves. See tmp/ux-audit.md #A6.
export default function AppShell() {
  const panels = useStore((s) => s.panels)

  return (
    <div className={styles.shell}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <ErrorBoundary label="The toolbar hit a snag">
        <Toolbar />
      </ErrorBoundary>
      <div className={styles.body}>
        <aside
          className={clsx('panel-dark', styles.left, !panels.left && styles.collapsedLeft)}
        >
          <ErrorBoundary label="The guest panel hit a snag">
            <GuestPanel />
          </ErrorBoundary>
        </aside>

        <main id="main-content" className={styles.center}>
          <ErrorBoundary label="The canvas hit a snag">
            <RoomCanvas />
          </ErrorBoundary>
        </main>

        <aside className={clsx(styles.right, !panels.right && styles.collapsedRight)}>
          <ErrorBoundary label="The inspector hit a snag">
            <RightSidebar />
          </ErrorBoundary>
        </aside>
      </div>
    </div>
  )
}
