// ──────────────────────────────────────────────────────────────────────────────
// Per-bot session state tracker.
//
// Each bot imports a Tracker instance and updates it when auth-sensitive
// operations succeed or fail. The dashboard queries this via /status to
// decide whether to show a "Login needed" banner or a login button.
// ──────────────────────────────────────────────────────────────────────────────

export type SessionState = 'unknown' | 'valid' | 'invalid' | 'checking';

export interface SessionStatus {
  state: SessionState;
  checked_at: string | null;
  message: string | null;
}

export class SessionTracker {
  private state: SessionState = 'unknown';
  private checkedAt: Date | null = null;
  private message: string | null = null;

  markValid(): void {
    this.state = 'valid';
    this.checkedAt = new Date();
    this.message = null;
  }

  markInvalid(reason?: string): void {
    this.state = 'invalid';
    this.checkedAt = new Date();
    this.message = reason ?? null;
  }

  markChecking(): void {
    this.state = 'checking';
    this.message = 'Login in Vorbereitung…';
  }

  /** Infer state from an error: returns true if the error looks like an auth failure. */
  handleError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not authenticated|login|session expired|unauthorized/i.test(msg)) {
      this.markInvalid(msg);
    }
  }

  snapshot(): SessionStatus {
    return {
      state: this.state,
      checked_at: this.checkedAt ? this.checkedAt.toISOString() : null,
      message: this.message,
    };
  }
}
