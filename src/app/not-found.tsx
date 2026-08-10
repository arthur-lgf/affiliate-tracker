import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-20">
      <div className="w-full max-w-lg text-center">
        <span className="eyebrow">Error 404</span>
        <h1 className="mt-4 font-display text-5xl leading-tight">
          That link doesn&rsquo;t <span className="italic text-signal">exist</span>
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          The affiliate link you followed was never created, or it has been deleted. Double-check the
          address with whoever shared it.
        </p>
        <Link href="/" className="btn mt-8">
          Go to the dashboard
        </Link>
      </div>
    </main>
  );
}
