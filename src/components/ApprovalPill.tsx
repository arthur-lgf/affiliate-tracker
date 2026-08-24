import { approvalLabel, isBypassed, NO_BYPASS, type Approval, type Bypass } from '@/lib/approval';

/**
 * One word for where an account stands.
 *
 * Five states, not three: pending splits into "they have not sent it yet" and
 * "it is sitting in your queue", which are the two an admin scanning this column
 * wants to tell apart because only the second is work. And a waived account is
 * its own thing again: nothing is blocked and nothing is waiting, whatever the
 * review column happens to say underneath.
 *
 * Gold is reserved in this palette for the one thing asking to be dealt with,
 * which is exactly what an account awaiting review is.
 */
export function ApprovalPill({
  approval,
  bypass = NO_BYPASS,
}: {
  approval: Approval;
  bypass?: Bypass;
}) {
  const label = approvalLabel(approval, bypass);

  const tone = isBypassed(bypass)
    ? 'border-navy-chip bg-navy-chip text-ink'
    : approval.status === 'approved'
      ? 'chip-live'
      : approval.status === 'declined'
        ? 'border-alarm-edge bg-alarm-wash text-alarm'
        : approval.submittedAt
          ? 'chip-gold'
          : 'chip-quiet';

  return <span className={`chip ${tone}`}>{label}</span>;
}
