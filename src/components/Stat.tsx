export function Stat({
  label,
  value,
  note,
  accent = false,
  delay = 0,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
  delay?: number;
}) {
  return (
    <div
      className="rise flex flex-col justify-between border-t-[3px] pt-3"
      style={{
        animationDelay: `${delay}ms`,
        borderTopColor: accent ? 'var(--color-signal)' : 'var(--color-ink)',
      }}
    >
      <span className="eyebrow">{label}</span>
      <span
        className="tnum mt-3 font-display text-[2.75rem] leading-none"
        style={{ color: accent ? 'var(--color-signal)' : undefined }}
      >
        {value}
      </span>
      {note ? <span className="mt-2 text-xs leading-relaxed text-muted">{note}</span> : null}
    </div>
  );
}
