import { SkeletonLine, SkeletonScreen } from '@/components/Skeleton';

/** The links list: heading, the create button, the filter bar, then the rows. */
export default function LinksLoading() {
  return (
    <SkeletonScreen label="Loading your links">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="flex flex-col gap-3">
          <SkeletonLine width={320} height={44} />
          <SkeletonLine width={240} height={22} />
        </div>
        <SkeletonLine width={150} height={60} className="rounded-full" />
      </div>

      <div className="panel mt-6 flex flex-wrap items-center gap-4 p-5">
        <SkeletonLine width={280} height={52} />
        <SkeletonLine width={92} height={44} className="rounded-full" />
        <SkeletonLine width={92} height={44} className="rounded-full" />
        <SkeletonLine width={110} height={44} className="rounded-full" />
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="panel flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-2">
                <SkeletonLine width={210} height={28} />
                <SkeletonLine width={160} height={20} />
              </div>
              <div className="flex gap-8">
                <SkeletonLine width={70} height={44} />
                <SkeletonLine width={70} height={44} />
                <SkeletonLine width={90} height={44} />
              </div>
            </div>
            <SkeletonLine width="70%" height={44} />
            <SkeletonLine width="55%" height={20} />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
