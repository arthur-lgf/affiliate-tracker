'use client';

import { useRef, useState } from 'react';

/**
 * Username and password, and nothing else.
 *
 * No third-party sign-in button: there is one account, it lives in the
 * environment, and a "continue with…" button would imply an identity provider
 * this tool does not have.
 */
export function LoginForm({ next }: { next: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, next }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(payload.error ?? `Could not sign in (${res.status})`);
        setBusy(false);
        // Move focus to the message so it is not just a colour change
        // somewhere below the button.
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }

      // A whole-document navigation rather than a client-side push: the cookie
      // was only just set, and this way the middleware re-runs against it and
      // every server component renders signed-in. No setBusy(false) — the page
      // is on its way out and re-enabling invites a second submit.
      window.location.assign(typeof payload.redirectTo === 'string' ? payload.redirectTo : '/');
    } catch {
      setError('Network error. Please try again.');
      setBusy(false);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8">
      <label className="block" htmlFor="username">
        <span className="field-label mb-2.5">Username</span>
        <input
          id="username"
          name="username"
          type="text"
          className="field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={120}
          required
          autoFocus
        />
      </label>

      <label className="mt-6 block" htmlFor="password">
        <span className="field-label mb-2.5">Password</span>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          maxLength={200}
          required
        />
      </label>

      {error ? (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mt-6 rounded-2xl border-2 border-alarm bg-alarm-wash px-5 py-4 text-[19px] font-semibold text-alarm outline-none"
        >
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className="btn-primary mt-8 w-full text-[21px]">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
