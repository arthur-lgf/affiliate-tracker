'use client';

import { useState } from 'react';
import { BusyLabel } from './Spinner';

/** Drops the session cookie and returns to the sign-in page. */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch {
      // Even if the request failed, send them to /login — the page re-checks
      // the cookie, so a still-valid session lands back on the dashboard
      // rather than showing a signed-out screen that is not true.
    }
    // Whole-document navigation so the middleware re-runs without the cookie.
    window.location.assign('/login');
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy}
      className="btn-quiet btn-sm"
    >
      <BusyLabel busy={busy} idle="Sign out" busyLabel="Signing out…" />
    </button>
  );
}
