export default function NotFound() {
  return (
    <main
      data-surface="cream"
      className="flex min-h-screen items-center justify-center bg-cream-100 px-6 py-20 text-ink"
    >
      <div className="w-full max-w-lg text-center">
        <p className="label-micro-light">Error 404</p>
        <h1 className="mt-4 font-display text-[44px] leading-tight">
          That link doesn&rsquo;t{' '}
          <span className="italic" style={{ color: 'var(--color-mustard-deep)' }}>
            exist
          </span>
        </h1>
        {/* No link to the dashboard: this page is reached by leads who mistyped
            an affiliate URL, and the admin routes are password-gated — sending
            them there is a browser credential prompt and a dead end. */}
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          The link you followed was never created, or it has been taken down.
          Double-check the address with whoever shared it with you.
        </p>
      </div>
    </main>
  );
}
