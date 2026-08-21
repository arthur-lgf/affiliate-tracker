/**
 * How these links may be shared.
 *
 * One component rather than the same paragraph typed on two pages, because the
 * two would drift: somebody adds a platform to the list on one of them and the
 * other quietly keeps saying something else. A rule that reads differently
 * depending on where you found it is not much of a rule.
 *
 * It appears where a link is copied (the links page) and where one is made (the
 * form), so it is read before the first link exists as well as beside every one
 * that already does.
 */
export function SharingRule({ className = 'mt-6' }: { className?: string }) {
  return (
    <p className={`warn-note ${className}`}>
      {/* Decoration: the sentence after it already says this is a prohibition,
          so a screen reader announcing "warning sign" first would only be
          hearing the same thing twice. */}
      <span aria-hidden className="warn-note-mark">
        ⚠
      </span>
      <span>
        <strong>Do not post these links publicly.</strong> Not on YouTube, Instagram, Facebook,
        TikTok, X, Reddit, or anywhere else open to the public. Send them directly to the person you
        are working with.
      </span>
    </p>
  );
}
