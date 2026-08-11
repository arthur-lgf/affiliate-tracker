export function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <div
      className="panel mx-auto max-w-[900px] p-6"
      style={{ border: '1px solid var(--color-mustard)' }}
      role="alert"
    >
      <p className="label-micro" style={{ color: 'var(--color-mustard)' }}>
        {title}
      </p>
      <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-cream">{message}</p>
      <p className="mt-3.5 text-[12.5px] leading-relaxed text-sage-dim">
        Check GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY (or your
        service-account.json), and confirm the sheet is shared with the service account as an
        Editor.
      </p>
    </div>
  );
}
