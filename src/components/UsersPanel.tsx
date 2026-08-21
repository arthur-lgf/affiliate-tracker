'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZES, pageSlice } from '@/lib/paging';
import { Pager } from './Pager';
import { TableScroller } from './TableScroller';
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

type RoleFilter = 'all' | 'admin' | 'affiliate';

const EMPTY: Fields = { username: '', role: 'affiliate', fullName: '', email: '' };

function softUsername(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '');
}

/**
 * "21 Aug 2026", or the plain truth that they never have.
 *
 * Deliberately not a relative time. "3 months ago" is the wrong unit for the
 * question this column answers, which is whether an account is still in use and
 * ought to still exist.
 */
function signInDate(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The accounts a search and a role filter leave behind.
 *
 * Pulled out as a plain function so it can be checked without mounting the
 * panel, which calls useRouter and so cannot be rendered outside a request.
 * Username, name and email all match: an admin looking someone up has whichever
 * one of the three they were given.
 */
export function matchAccounts(rows: AccountRow[], query: string, role: RoleFilter): AccountRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (role !== 'all' && row.role !== role) return false;
    if (!needle) return true;
    return [row.username, row.fullName, row.email, row.usr]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
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
   * Which of the row's three buttons is running. `busy` alone says which row,
   * and a row has Reset password, Disable/Enable and Delete side by side — so
   * without this the spinner would have to go on all three or none.
   */
  const [running, setRunning] = useState<null | 'reset-password' | 'enable' | 'disable' | 'delete'>(
    null,
  );
  const [issued, setIssued] = useState<Issued | null>(null);
  /* The create form is a drawer rather than a permanent fixture at the top of
     the page. Adding someone happens a handful of times a year; reading the
     list happens every week, and the form was pushing it below the fold. */
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const issuedRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLInputElement | null>(null);

  const matched = useMemo(() => matchAccounts(rows, query, role), [rows, query, role]);

  /*
   * Sliced rather than cut: an account disabled or deleted from the last page
   * shortens the list under a page number this component is still holding, and
   * pageSlice clamps that back to the last page there is.
   */
  const visible = pageSlice(matched, page, perPage);

  // Move focus to the password the moment it appears. It is shown exactly once,
  // so a screen reader user must not have to go looking for it, and a sighted
  // user should not miss it because the page scrolled.
  useEffect(() => {
    if (issued) issuedRef.current?.focus();
  }, [issued]);

  // Opening the drawer puts the caret in the first field. A form that appears
  // somewhere below the button you just pressed is a form you then have to go
  // and find.
  useEffect(() => {
    if (adding) formRef.current?.focus();
  }, [adding]);

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
      // Closed on success only. A failed submit keeps the form open with what
      // was typed still in it.
      setAdding(false);
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
        <p role="alert" className="warn-note mt-5">
          <span aria-hidden className="warn-note-mark">
            ⚠
          </span>
          <span>{error}</span>
        </p>
      ) : null}

      {/* Add someone — a drawer, opened from the toolbar below */}
      {adding ? (
        <section className="panel mt-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-edge px-5 py-3.5">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.03em] text-ink-soft">
              Add someone
            </h2>
            <button type="button" className="btn-quiet btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>

          <form onSubmit={create} className="grid gap-5 p-5 lg:grid-cols-2">
            <p className="plain lg:col-span-2">
              The password is generated here and shown once. Nothing stores it, so if it is lost the
              only way forward is to reset it.
            </p>

            <label className="block">
              <span className="field-label">Username</span>
              <input
                ref={formRef}
                className="field mt-1.5"
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
              {fieldErrors.username ? (
                <span className="field-error">{fieldErrors.username}</span>
              ) : null}
            </label>

            <fieldset className="block">
              <legend className="field-label">What they can see</legend>
              <div className="mt-1.5 flex flex-wrap gap-2.5">
                {(
                  [
                    ['affiliate', 'Their own links only'],
                    ['admin', 'Everything, and can add people'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="pill-filter cursor-pointer"
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
              <span className="field-note">
                {affiliate
                  ? 'A six-character tracking key is generated with the account. It becomes the ?usr= on their links, and it decides which rows they can see.'
                  : 'An admin sees every person’s numbers and is the only role that can create links, record approvals and add people.'}
              </span>
            </fieldset>

            <label className="block">
              <span className="field-label">Full name</span>
              <input
                className="field mt-1.5"
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
                className="field mt-1.5"
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
      ) : null}

      {/* The list */}
      <div className="panel mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-edge px-5 py-3.5">
          <div className="min-w-[180px] flex-1">
            <label className="sr-only" htmlFor="account-search">
              Search accounts
            </label>
            <input
              id="account-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search a username, name or email…"
              className="field"
            />
          </div>

          <label className="sr-only" htmlFor="account-role">
            Filter accounts by role
          </label>
          <select
            id="account-role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as RoleFilter);
              setPage(1);
            }}
            className="field w-auto"
          >
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="affiliate">Affiliate</option>
          </select>

          {/* The primary action sits in the toolbar rather than above it: this
              panel is the whole page, and a button floating over it would have
              nothing to belong to. */}
          <button
            type="button"
            className="btn-gold"
            aria-expanded={adding}
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? 'Close form' : '+ Add account'}
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-16 text-center text-[13px] text-ink-soft">
            Nobody yet. You are signed in as <strong>{viewerUsername}</strong>, which comes from the
            environment rather than from this list.
          </p>
        ) : matched.length === 0 ? (
          <p className="px-5 py-16 text-center text-[13px] text-ink-soft">
            Nothing matches{query ? ` “${query}”` : ''} in this view.
          </p>
        ) : (
          <TableScroller label="Accounts" controlsClassName="px-5 pt-3">
            <table className="w-full min-w-[1040px] border-collapse text-left">
              <thead>
                <tr className="bg-paper-card">
                  <Th>Username</Th>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Tracking key</Th>
                  <Th>Last sign-in</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const isSelf = row.id === viewerId;
                  const working = busy === row.id;
                  return (
                    <tr key={row.id} className="divider-row last:border-0">
                      <td className="px-5 py-3.5">
                        <span className="flex items-center gap-2">
                          <span className="tnum text-[13px] font-medium">{row.username}</span>
                          {isSelf ? <span className="chip chip-quiet">You</span> : null}
                        </span>
                      </td>

                      <td className="max-w-[220px] px-5 py-3.5">
                        <span className="block truncate text-[14px]">
                          {row.fullName || <span className="text-ink-dim">No name given</span>}
                        </span>
                        {row.email ? (
                          <span className="mt-0.5 block truncate text-[11px] text-ink-dim">
                            {row.email}
                          </span>
                        ) : null}
                      </td>

                      <td className="px-5 py-3.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span
                            className={`chip chip-quiet ${row.role === 'admin' ? 'text-ink' : ''}`}
                          >
                            {row.role === 'admin' ? 'Admin' : 'Affiliate'}
                          </span>
                          {/* Disabled is the state worth interrupting for: the
                              account is still listed and still cannot sign in. */}
                          {row.active ? null : (
                            <span className="chip border-alarm-edge bg-alarm-wash text-alarm">
                              Disabled
                            </span>
                          )}
                        </span>
                      </td>

                      <td className="tnum px-5 py-3.5 text-[12px] text-ink-dim">
                        {row.usr ? `usr=${row.usr}` : '—'}
                      </td>

                      <td className="tnum px-5 py-3.5 text-[13px] text-ink-dim">
                        {signInDate(row.lastLoginAt)}
                      </td>

                      <td className="whitespace-nowrap px-5 py-2.5 text-right">
                        <span className="inline-flex justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn-quiet btn-sm"
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
        )}

        {/* Nothing to page through when there is nobody: the line above
            already says so, and better than a count of zero would. */}
        {rows.length > 0 ? (
          <Pager
            total={matched.length}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
            label="Accounts"
            note={matched.length === rows.length ? '' : ` · ${rows.length} in total`}
            className="border-t border-edge px-5 py-3"
          />
        ) : null}
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`label-cap border-b border-edge px-5 py-2.5 text-[10px] ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
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
      /* The one panel in the app with a gold edge. Gold is the highlighter
         everywhere else here, and this is the one thing on the page that has
         to be read before it is scrolled past. */
      className="panel mt-5 border-gold-edge p-5"
    >
      <h2 className="text-[16px]">
        {issued.reason === 'created' ? 'Account created' : 'New password'} for {issued.username}
      </h2>
      <p className="plain mt-2">
        Copy this now and give it to them. It is not stored anywhere and cannot be shown again. If
        it is lost, reset it and hand over a new one.
      </p>

      {issued.usr ? (
        <p className="plain mt-2">
          Their tracking key is{' '}
          <code className="tnum font-semibold text-ink">{issued.usr}</code> — it is already picked
          for them on the create-a-link page, and it stays in the list below.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Selectable text, not an input: there is nothing to edit, and select-all
            is the fallback when the clipboard is unavailable. */}
        <code className="url-box tnum select-all text-[14px] font-semibold tracking-[0.08em]">
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
