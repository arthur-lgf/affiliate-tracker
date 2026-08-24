import Link from 'next/link';
import {
  canOpen,
  progressOf,
  stepsFor,
  type OnboardingState,
  type StepKey,
} from '@/lib/onboarding';

/**
 * Where they are in the four steps.
 *
 * Numbered rather than ticked-or-not, because the useful fact here is not
 * "three done" but "two more to go" — somebody deciding whether to start this
 * now or after lunch is asking how much is left.
 *
 * A finished step is a link back to itself. It was a plain list while the guard
 * bounced anyone off a step they had completed — a control that always refuses
 * being worse than no control — but the guard allows it now, so the four
 * headings people are already reading as a map are the map.
 *
 * A step not yet reached stays plain text. Nothing here can be used to skip
 * ahead, which is the one ordering the flow actually depends on.
 *
 * A waived account sees two steps rather than four, numbered one and two.
 * Drawing the agreement and the W-9 greyed out would be a map to two rooms
 * that have been taken off the building.
 */
export function OnboardingRail({
  current,
  state,
  bypassed = false,
}: {
  current: StepKey;
  state: OnboardingState;
  bypassed?: boolean;
}) {
  const steps = stepsFor({ bypassed });
  const { done, total } = progressOf(state, { bypassed });

  return (
    <div className="panel overflow-hidden">
      <ol className="flex flex-col sm:flex-row">
        {steps.map((step, index) => {
          const isCurrent = step.key === current;
          const isDone = state[step.key];
          // Openable and not where they already are: worth a link.
          const linked = !isCurrent && isDone && canOpen(state, step.key, { bypassed });

          const inner = (
            <>
              <span
                aria-hidden
                className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[2px] text-[11px] font-semibold ${
                  isDone
                    ? 'bg-leaf-wash text-leaf-text'
                    : isCurrent
                      ? 'bg-navy text-white'
                      : 'bg-paper-sunk text-ink-dim'
                }`}
              >
                {isDone ? '✓' : index + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-[13px] ${
                    isCurrent ? 'font-semibold text-ink' : 'text-ink-soft'
                  }`}
                >
                  {step.label}
                </span>
                {step.required ? null : (
                  <span className="block text-[11px] text-ink-dim">Can wait</span>
                )}
              </span>
            </>
          );

          const shared = 'flex min-w-0 flex-1 items-center gap-3 px-5 py-3.5';

          return (
            <li
              key={step.key}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex min-w-0 flex-1 border-b border-edge last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${
                isCurrent ? 'bg-paper-card' : ''
              }`}
            >
              {linked ? (
                <Link
                  href={step.path}
                  className={`${shared} hover:bg-paper-card`}
                  title={`Back to ${step.label.toLowerCase()}`}
                >
                  {inner}
                </Link>
              ) : (
                <span className={shared}>{inner}</span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="border-t border-edge bg-paper-card px-5 py-2.5 text-[12px] text-ink-dim">
        <span className="tnum font-semibold text-ink-soft">
          {done} of {total}
        </span>{' '}
        done.{' '}
        {bypassed
          ? 'Neither of these is blocking your dashboard. They are here whenever you want them.'
          : 'The first three are needed before you can use the dashboard.'}
      </p>
    </div>
  );
}
