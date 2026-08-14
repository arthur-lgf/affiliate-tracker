import { SkeletonLine } from '@/components/Skeleton';

/**
 * The landing page, waiting.
 *
 * This one earns its keep more than any of the others. It is the only page a
 * stranger ever sees, it is reached by clicking a link in a message with no
 * browser chrome to say anything is happening, and every visit resolves the
 * slug against the store before it can render. A blank white second here is
 * the second in which somebody decides the link is broken.
 *
 * With the capture form switched off the page redirects instead, and this is
 * what covers the hop.
 */
export default function LandingLoading() {
  return (
    <main className="min-h-screen bg-paper px-5 py-10 sm:px-8 sm:py-14">
      <span role="status" className="sr-only">
        Loading this offer
      </span>
      <div
        aria-hidden
        className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[680px] flex-col sm:min-h-[calc(100vh-7rem)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="flex items-center gap-3">
            <SkeletonLine width={28} height={28} className="flex-none rounded-full" />
            <SkeletonLine width={130} height={22} />
          </span>
          <SkeletonLine width={110} height={22} />
        </div>

        <div className="mt-10 flex flex-col gap-4">
          <SkeletonLine width="92%" height={54} />
          <SkeletonLine width="64%" height={54} />
          <SkeletonLine width="80%" height={26} className="mt-3" />
        </div>

        <div className="mt-10 flex flex-col gap-6">
          {[0, 1].map((index) => (
            <div key={index} className="flex flex-col gap-3">
              <SkeletonLine width={150} height={22} />
              <SkeletonLine height={64} className="rounded-[14px]" />
            </div>
          ))}
          <SkeletonLine height={68} className="rounded-full" />
          <SkeletonLine width="70%" height={20} />
        </div>
      </div>
    </main>
  );
}
