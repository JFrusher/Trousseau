import { Component } from 'react'
import styles from './ErrorBoundary.module.css'

/**
 * Error boundaries are the one place React still requires a class component
 * (there is no hook equivalent). Wraps a panel so a render error in one region
 * doesn't take down the whole app.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[Tableaux] panel error:', error, info)
  }

  // TODO(ux-audit): only clears local boundary state — doesn't reset/reload
  // the data that caused the crash. If the crash was caused by corrupted
  // table/guest data, "Try again" just re-throws immediately, trapping the
  // user with no offered page-reload option and no way to see full error
  // detail beyond error.message. See tmp/ux-audit.md #A11.
  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className={styles.fallback}>
          <p className={styles.title}>{this.props.label || 'Something went wrong'}</p>
          <p className={styles.detail}>{this.state.error.message}</p>
          <button className={styles.retry} onClick={this.reset}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
