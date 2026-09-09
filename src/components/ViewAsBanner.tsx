'use client';

import { useState } from 'react';
import { BusyLabel } from './Spinner';

type Props = { username: string; usr: string; adminName: string };

/**
 * The standing reminder that you are not yourself.
 *
 * Loud on purpose, and it neither collapses nor dismisses. Every figure on every
 * page below it belongs to one person, the header avatar reads as that person,
 * and an admin who forgets which of those they are can sign an agreement in
 * somebody else's name. A banner is cheap; that mistake is not.
 *
 * It sits above the navigation rather than inside a page, so it is present on
 * the onboarding steps too — which is exactly where an admin lands when the
 * client they came to check on has not finished signing up.
 */
export function ViewAsBanner({ username, usr, adminName }: Props) {
  const [busy, setBusy] = useState(false);

  async function exit() {
    setBusy(true);
    try {
      await fetch('/api/view-as', { method: 'DELETE' });
    } catch {
      // Navigate anyway. The cookie may well have gone, and the destination
      // re-reads it — landing back here is a truthful answer either way.
    }
    // Whole-document navigation so the middleware and every server component
    // re-run without the ticket, rather than reusing a render made with it.
    window.location.assign('/users');
  }

  return (
    <div className="no-print border-b border-gold bg-gold px-5 py-2.5 text-navy sm:px-7">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span aria-hidden>&#128065;</span>
        <strong className="font-semibold">You are viewing as {username}.</strong>
        <span className="opacity-80">
          Signed in as {adminName} &middot; usr={usr} &middot; anything you submit is
          recorded as {username}&rsquo;s own.
        </span>
        <button
          type="button"
          onClick={exit}
          disabled={busy}
          aria-busy={busy}
          className="ml-auto flex-none whitespace-nowrap font-semibold underline underline-offset-2 disabled:opacity-60"
        >
          <BusyLabel busy={busy} idle="Stop viewing as them" busyLabel="Exiting…" />
        </button>
      </p>
    </div>
  );
}
