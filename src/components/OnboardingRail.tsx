import { progressOf, STEPS, type OnboardingState, type StepKey } from '@/lib/onboarding';

/**
 * Where they are in the four steps.
 *
 * Numbered rather than ticked-or-not, because the useful fact here is not
 * "three done" but "two more to go" — somebody deciding whether to start this
 * now or after lunch is asking how much is left.
 *
 * A plain list, not links. Jumping back to a signed agreement would only bounce
 * off the guard, and a control that always refuses is worse than no control.
 */
export function OnboardingRail({
  current,
  state,
}: {
  current: StepKey;
  state: OnboardingState;
}) {
  const { done, total } = progressOf(state);

  return (
    <div className="panel overflow-hidden">
      <ol className="flex flex-col sm:flex-row">
        {STEPS.map((step, index) => {
          const isCurrent = step.key === current;
          const isDone = state[step.key];
          return (
            <li
              key={step.key}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex min-w-0 flex-1 items-center gap-3 border-b border-edge px-5 py-3.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${
                isCurrent ? 'bg-paper-card' : ''
              }`}
            >
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
            </li>
          );
        })}
      </ol>

      <p className="border-t border-edge bg-paper-card px-5 py-2.5 text-[12px] text-ink-dim">
        <span className="tnum font-semibold text-ink-soft">
          {done} of {total}
        </span>{' '}
        done. The first three are needed before you can use the dashboard.
      </p>
    </div>
  );
}
