/**
 * The ring that means "working".
 *
 * Presentational and server-safe: no state, no hooks, so it drops into a server
 * component as happily as into a client one.
 *
 * It is `aria-hidden` on purpose. A spinner inside a button is decoration —
 * what a screen reader needs is the button's own label changing from "Save
 * approval" to "Saving…", which is what every caller does. Announcing the ring
 * as well would say the same thing twice, half a second apart.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`spinner ${className}`} />;
}

/**
 * The whole of a button's busy state: the ring, and the word for what is
 * happening. Callers pass the two labels and a flag, so no button has to
 * remember to do both.
 */
export function BusyLabel({
  busy,
  idle,
  busyLabel,
}: {
  busy: boolean;
  idle: React.ReactNode;
  busyLabel: string;
}) {
  if (!busy) return <>{idle}</>;
  return (
    <>
      <Spinner />
      {busyLabel}
    </>
  );
}
