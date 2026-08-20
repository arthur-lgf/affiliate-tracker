'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { initialsOf } from '@/lib/analytics';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';
import { Pager } from './Pager';
import { BusyLabel } from './Spinner';

export type AccountRow = {
  id: string;
  username: string;
  role: 'admin' | 'affiliate';
  usr: string;
  fullName: string;
  email: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  createdBy: string;
};

type Fields = {
  username: string;
  role: 'admin' | 'affiliate';
  fullName: string;
  email: string;
};

const EMPTY: Fields = { username: '', role: 'affiliate', fullName: '', email: '' };

function softUsername(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '');
}

/**
 * The password that was just issued, and who it belongs to.
 *
 * `usr` is carried too, but only for a newly created affiliate: the generated
 * tracking key is the other thing an admin needs off this screen, and it is
 * shown here rather than hunted for in the list below.
 */
type Issued = {
  username: string;
  password: string;
  reason: 'created' | 'reset';
  usr?: string;
};

export function UsersPanel({
  rows,
  viewerId,
  viewerUsername,
}: {
  rows: AccountRow[];
  viewerId: string;
  viewerUsername: string;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Which of the row's four buttons is running. `busy` alone says which row,
   * and a row has Reset password, Disable, Enable and Delete side by side —
   * so without this the spinner would have to go on all four or none.
   */
  const [running, setRunning] = useState<null | 'reset-password' | 'enable' | 'disable' | 'delete'>(
    null,
  );
  const [issued, setIssued] = useState<Issued | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const issuedRef = useRef<HTMLDivElement | null>(null);

  /*
   * Sliced rather than cut: an account disabled or deleted from the last page
   * shortens the list under a page number this component is still holding, and
   * pageSlice clamps that back to the last page there is.
   */
  const visible = pageSlice(rows, page, perPage);

  // Move focus to the password the moment it appears. It is shown exactly once,
  // so a screen reader user must not have to go looking for it, and a sighted
  // user should not miss it because the page scrolled.
  useEffect(() => {
    if (issued) issuedRef.current?.focus();
  }, [issued]);

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: fields.username.trim().toLowerCase(),
          role: fields.role,
          fullName: fields.fullName.trim(),
          email: fields.email.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not create that account.');
        if (data.fields) setFieldErrors(data.fields);
        return;
      }
      setIssued({
        username: data.user.username,
        password: data.password,
        reason: 'created',
        usr: data.user.usr || undefined,
      });
      setFields(EMPTY);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
      setRunning(null);
    }
  }

  async function act(row: AccountRow, action: 'reset-password' | 'enable' | 'disable') {
    if (action === 'disable' && !confirm(`Disable ${row.username}? They will be signed out.`)) return;
    setBusy(row.id);
    setRunning(action);
    setError(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'That did not work.');
        return;
      }
      if (action === 'reset-password') {
        setIssued({ username: row.username, password: data.password, reason: 'reset' });
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
      setRunning(null);
    }
  }

  async function remove(row: AccountRow) {
    if (
      !confirm(
        `Delete ${row.username} for good? Their links, leads and approvals are not touched — only the sign-in goes.`,
      )
    ) {
      return;
    }
    setBusy(row.id);
    setRunning('delete');
    setError(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'That did not work.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
      setRunning(null);
    }
  }

  const affiliate = fields.role === 'affiliate';

  return (
    <div className="w-full">
      {issued ? (
        <PasswordReveal issued={issued} onDismiss={() => setIssued(null)} ref={issuedRef} />
      ) : null}

      {error ? (
        <p role="alert" className="panel mt-5 border-2 p-5 text-[19px] text-ink">
          {error}
        </p>
      ) : null}

      {/* Create */}
      <section className="rise panel mt-5 p-6 sm:p-8">
        <h2 className="font-display text-[32px]">Add someone</h2>
        <p className="plain mt-2">
          The password is generated here and shown once. Nothing stores it, so if it is lost the
          only way forward is to reset it.
        </p>

        <form onSubmit={create} className="mt-6 grid gap-5 lg:grid-cols-2">
          <label className="block">
            <span className="field-label">Username</span>
            <input
              className="field"
              value={fields.username}
              onChange={(e) => set('username', softUsername(e.target.value))}
              placeholder="arthur"
              autoComplete="off"
              spellCheck={false}
              required
              aria-describedby="username-note"
              aria-invalid={fieldErrors.username ? true : undefined}
            />
            <span id="username-note" className="field-note">
              What they type to sign in. Lowercase letters, numbers, dot, dash and underscore.
            </span>
            {fieldErrors.username ? <span className="field-error">{fieldErrors.username}</span> : null}
          </label>

          <fieldset className="block">
            <legend className="field-label">What they can see</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {(
                [
                  ['affiliate', 'Their own links only'],
                  ['admin', 'Everything, and can add people'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="pill-filter min-h-11 cursor-pointer"
                  data-active={fields.role === value}
                >
                  <input
                    type="radio"
                    name="role"
                    value={value}
                    checked={fields.role === value}
                    onChange={() => set('role', value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <p className="self-end text-[19px] text-ink-soft">
            {affiliate
              ? 'A six-character tracking key is generated when you create the account. It becomes the ?usr= on their links, and it decides which rows they can see.'
              : 'An admin sees every person’s numbers and is the only role that can create links, record approvals and add people.'}
          </p>

          <label className="block">
            <span className="field-label">Full name</span>
            <input
              className="field"
              value={fields.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              placeholder="Arthur Reyes"
              autoComplete="off"
            />
            <span className="field-note">Optional. Only used to label them here.</span>
          </label>

          <label className="block">
            <span className="field-label">Email</span>
            <input
              className="field"
              type="email"
              value={fields.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="arthur@example.com"
              autoComplete="off"
              aria-invalid={fieldErrors.email ? true : undefined}
            />
            <span className="field-note">
              Optional, and nothing is sent to it. The password is handed over by you.
            </span>
            {fieldErrors.email ? <span className="field-error">{fieldErrors.email}</span> : null}
          </label>

          <div className="lg:col-span-2">
            <button
              type="submit"
              className="btn-gold"
              disabled={busy === 'create'}
              aria-busy={busy === 'create'}
            >
              <BusyLabel busy={busy === 'create'} idle="Create account" busyLabel="Creating…" />
            </button>
          </div>
        </form>
      </section>

      {/* The list */}
      <section className="rise panel mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-[32px]">Accounts</h2>
          <span className="text-[19px] text-ink-soft">
            {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="py-10 text-center text-[19px] text-ink-soft">
            Nobody yet. You are signed in as <strong>{viewerUsername}</strong>, which comes from the
            environment rather than from this list.
          </p>
        ) : (
          <ul className="mt-6 flex flex-col gap-4">
            {visible.map((row) => {
              const isSelf = row.id === viewerId;
              const working = busy === row.id;
              return (
                <li
                  key={row.id}
                  className={`${row.active ? 'card-row-lit' : 'card-row'} flex flex-wrap items-center gap-x-6 gap-y-4 p-5 sm:px-6`}
                >
                  <span aria-hidden className="disc h-14 w-14 flex-none text-[19px]">
                    {initialsOf(row.fullName || row.username)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="truncate text-[23px] font-semibold">{row.username}</span>
                      <span className={row.role === 'admin' ? 'chip chip-gold' : 'chip chip-quiet'}>
                        {row.role === 'admin' ? 'Admin' : `usr=${row.usr}`}
                      </span>
                      {row.active ? null : <span className="chip">Disabled</span>}
                      {isSelf ? <span className="chip chip-quiet">You</span> : null}
                    </span>
                    <span className="mt-1 block truncate text-[18px] text-ink-soft">
                      {row.fullName || 'No name given'}
                      {row.email ? ` · ${row.email}` : ''}
                      {row.lastLoginAt
                        ? ` · last in ${new Date(row.lastLoginAt).toLocaleDateString()}`
                        : ' · never signed in'}
                    </span>
                  </span>

                  <span className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="btn-outline btn-sm"
                      disabled={working}
                      aria-busy={working && running === 'reset-password'}
                      onClick={() => act(row, 'reset-password')}
                    >
                      <BusyLabel
                        busy={working && running === 'reset-password'}
                        idle="Reset password"
                        busyLabel="Resetting…"
                      />
                    </button>
                    {row.active ? (
                      <button
                        type="button"
                        className="btn-quiet btn-sm"
                        disabled={working || isSelf}
                        aria-busy={working && running === 'disable'}
                        title={isSelf ? 'You cannot disable your own account' : undefined}
                        onClick={() => act(row, 'disable')}
                      >
                        <BusyLabel
                          busy={working && running === 'disable'}
                          idle="Disable"
                          busyLabel="Disabling…"
                        />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-quiet btn-sm"
                        disabled={working}
                        aria-busy={working && running === 'enable'}
                        onClick={() => act(row, 'enable')}
                      >
                        <BusyLabel
                          busy={working && running === 'enable'}
                          idle="Enable"
                          busyLabel="Enabling…"
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={working || isSelf}
                      aria-busy={working && running === 'delete'}
                      title={isSelf ? 'You cannot delete your own account' : undefined}
                      onClick={() => remove(row)}
                    >
                      <BusyLabel
                        busy={working && running === 'delete'}
                        idle="Delete"
                        busyLabel="Deleting…"
                      />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* Nothing to page through when there is nobody: the line above
            already says so, and better than a count of zero would. */}
        {rows.length > 0 ? (
          <Pager
            total={rows.length}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
            label="Accounts"
          />
        ) : null}
      </section>
    </div>
  );
}

/**
 * The one and only sight of a new password.
 *
 * Deliberately loud, deliberately dismissible only by choice, and it does not
 * disappear on a re-render: losing it costs a reset, and a person who has just
 * clicked "create" is about to look away to write it down.
 */
const PasswordReveal = function PasswordReveal({
  issued,
  onDismiss,
  ref,
}: {
  issued: Issued;
  onDismiss: () => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard on plain http. The password is on screen and selectable,
      // which is the fallback.
    }
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rise panel mt-5 border-2 p-6 sm:p-8"
      style={{ borderColor: 'var(--color-gold-edge)' }}
    >
      <h2 className="font-display text-[30px]">
        {issued.reason === 'created' ? 'Account created' : 'New password'} for {issued.username}
      </h2>
      <p className="plain mt-2">
        Copy this now and give it to them. It is not stored anywhere and cannot be shown again. If
        it is lost, reset it and hand over a new one.
      </p>

      {issued.usr ? (
        <p className="plain mt-3">
          Their tracking key is{' '}
          <code className="tnum font-semibold text-ink">{issued.usr}</code> — it is already picked
          for them on the create-a-link page, and it stays visible in the list below.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        {/* Selectable text, not an input: there is nothing to edit, and select-all
            is the fallback when the clipboard is unavailable. */}
        <code className="url-box tnum select-all text-[24px] font-semibold tracking-[0.08em]">
          {issued.password}
        </code>
        <button type="button" className="btn-primary" onClick={copy} aria-live="polite">
          {copied ? '✓ Copied' : 'Copy password'}
        </button>
        <button type="button" className="btn-quiet" onClick={onDismiss}>
          I have saved it
        </button>
      </div>
    </div>
  );
};
