import { Component, type ReactNode } from 'react';

/** Forgets this tab's Google session (google/auth.ts) and starts over. */
function signOut() {
  try {
    sessionStorage.removeItem('vacation-planner.session');
  } catch {
    // nothing kept
  }
  location.reload();
}

/**
 * The last line of defence: if drawing the page fails, show what happened and a way on instead
 * of a blank page. Outside the language context (it may be what failed), so it speaks both
 * languages. Changes are safe on this device (sync/Replica.ts), so reloading loses nothing.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="load-state" role="alert">
        <p lang="ro">Ceva n-a mers și pagina nu s-a putut afișa. Modificările tale sunt păstrate pe acest dispozitiv.</p>
        <p lang="en">Something went wrong and the page couldn’t be shown. Your changes are kept on this device.</p>
        <div className="load-actions">
          <button type="button" className="primary" onClick={() => location.reload()}>
            Reîncarcă · Reload
          </button>
          <button type="button" onClick={signOut}>
            Deconectare · Sign out
          </button>
        </div>
        <details className="detail">
          <summary>Detalii tehnice · Technical details</summary>
          {this.state.error instanceof Error ? this.state.error.message : String(this.state.error)}
        </details>
      </div>
    );
  }
}
