export function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <div
      className="panel p-6"
      style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal-wash)' }}
      role="alert"
    >
      <p className="eyebrow" style={{ color: 'var(--color-signal-2)' }}>
        {title}
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">{message}</p>
      <p className="mt-3 font-mono text-[0.6875rem] leading-relaxed text-muted">
        Check GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY in .env.local, and
        confirm the sheet is shared with the service account as an Editor.
      </p>
    </div>
  );
}
