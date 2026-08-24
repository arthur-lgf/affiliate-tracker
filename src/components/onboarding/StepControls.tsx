import Link from 'next/link';

/**
 * The two controls that make a four-step form something you can move around in
 * rather than only forwards through.
 *
 * Neither of them submits anything. That is the point: going back to look at
 * what you typed on the previous screen should cost nothing and change nothing,
 * and a Back button that saved on the way out would be a Back button people
 * learn not to press.
 */

/** Back to the step before this one. Absent on the first step, which has no
 *  before. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link href={to} className="btn-outline btn-sm">
      <span aria-hidden>←</span> {label}
    </Link>
  );
}

/**
 * Leaving a completed step without re-submitting it.
 *
 * Only shown on a revisit, and only when there is somewhere to go. Without it
 * the sole way off a finished step is the submit button, which on a signed
 * document means signing it again to get past a page you opened to read.
 */
export function ContinueLink({ to, label }: { to: string; label: string }) {
  return (
    <Link href={to} className="text-[13px] text-link hover:underline">
      {label} <span aria-hidden>→</span>
    </Link>
  );
}

/**
 * Said at the top of a step that is already done.
 *
 * `resign` is for the two steps that carry a signature: on those, saving again
 * is not an edit but a fresh signature at a fresh time, and somebody who opened
 * the page to check a spelling deserves to know that before they start
 * changing things.
 */
export function RevisitNotice({
  savedAt,
  what,
  resign = false,
}: {
  savedAt?: string;
  what: string;
  resign?: boolean;
}) {
  return (
    <div className="panel mt-5 border-leaf-edge bg-leaf-wash p-5">
      <p className="text-[13px] text-ink">
        <span aria-hidden className="mr-1.5 font-semibold text-leaf-text">
          ✓
        </span>
        You have already done this step
        {savedAt ? (
          <>
            {', '}
            <span className="tnum">{savedAt}</span>
          </>
        ) : null}
        . {what}
      </p>
      {resign ? (
        <p className="plain mt-1.5">
          Nothing changes unless you save. If you do change something you will need to sign again,
          and the copy on file becomes the new one.
        </p>
      ) : (
        <p className="plain mt-1.5">Nothing changes unless you save.</p>
      )}
    </div>
  );
}
