export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-20">
      <div className="w-full max-w-xl text-center">
        <p className="label-cap">Error 404</p>
        <h1 className="mt-5 font-display text-[46px] leading-tight sm:text-[54px]">
          That link doesn&rsquo;t <span className="italic text-gold-deep">exist</span>
        </h1>
        {/* No link to the dashboard: this page is reached by leads who mistyped
            an affiliate URL, and the admin routes are password-gated — sending
            them there is a browser credential prompt and a dead end. */}
        <p className="mt-5 text-[21px] leading-relaxed text-ink-soft">
          The link you followed was never created, or it has been taken down.
          Double-check the address with whoever shared it with you.
        </p>
      </div>
    </main>
  );
}
