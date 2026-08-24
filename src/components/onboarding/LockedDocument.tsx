/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';

export type DocumentFact = { label: string; value: string };

/**
 * A signed document that has been settled.
 *
 * Shown instead of the form, not on top of it. A form with every field disabled
 * is a worse thing than no form: it still looks like somewhere to type, it
 * still has a button, and the only way to find out what it does is to fill it
 * in and be refused. This says what is on file, shows the signature that is on
 * it, hands over the PDF, and offers nothing to press that will not work.
 *
 * Nothing here is a dead end either. The record is readable, the file is
 * downloadable, and the copy says who to ask when a correction is genuinely
 * needed, because "locked" without a way forward is just a wall.
 */
export function LockedDocument({
  title,
  savedAt,
  note,
  facts,
  signaturePng,
  downloadHref,
  onward,
}: {
  /** "Signed" or "Filed": what happened, in one word the heading can carry. */
  title: string;
  savedAt: string;
  note: string;
  facts: DocumentFact[];
  signaturePng?: string;
  downloadHref: string;
  onward: { path: string; label: string };
}) {
  return (
    <section className="panel mt-6 overflow-hidden">
      <div className="border-b border-leaf-edge bg-leaf-wash px-5 py-4 sm:px-6">
        <p className="text-[13px] leading-relaxed text-ink">
          <span aria-hidden className="mr-1.5 font-semibold text-leaf-text">
            ✓
          </span>
          <strong className="font-semibold">
            {title}
            {savedAt ? ` on ${savedAt}` : ''}.
          </strong>{' '}
          {note}
        </p>
      </div>

      <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <span className="field-label">{fact.label}</span>
            <p className="mt-1 break-words text-[13px] text-ink-soft">{fact.value || 'Not given'}</p>
          </div>
        ))}
      </dl>

      {signaturePng?.startsWith('data:image/png;base64,') ? (
        <div className="border-t border-edge-faint px-5 pb-5 sm:px-6">
          <span className="field-label">Signature</span>
          {/* A data URL, so next/image would have nothing to optimise. */}
          <img
            src={signaturePng}
            alt="The signature on file"
            className="mt-1.5 max-h-[80px] w-auto max-w-full rounded-[3px] border border-edge bg-panel p-2"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-edge bg-paper-card px-5 py-4 sm:px-6">
        <a href={downloadHref} className="btn-outline btn-sm">
          Download PDF
        </a>
        <Link href={onward.path} className="link-text text-[13px] font-medium">
          {onward.label}
        </Link>
      </div>
    </section>
  );
}
