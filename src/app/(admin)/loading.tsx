import {
  SkeletonHeading,
  SkeletonLine,
  SkeletonPanel,
  SkeletonPills,
  SkeletonRow,
  SkeletonScreen,
} from '@/components/Skeleton';

/**
 * The dashboard, waiting.
 *
 * This is also the fallback for any admin page that has no loading file of its
 * own, which is why it is the dashboard's shape rather than something generic:
 * the dashboard is where every navigation starts and ends.
 *
 * Every one of these pages reads four tables and rolls them up, so the wait is
 * real and worth drawing.
 */
export default function DashboardLoading() {
  return (
    <SkeletonScreen label="Loading your dashboard">
      <div className="flex flex-wrap items-center gap-3">
        <SkeletonLine width={92} height={24} />
        <SkeletonPills />
      </div>

      {/* Hero: the earnings figure and its chart. */}
      <SkeletonPanel className="mt-5 grid gap-10 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <SkeletonLine width={220} height={20} />
          <SkeletonLine width="80%" height={72} />
          <div className="flex flex-wrap gap-4">
            <SkeletonLine width={140} height={38} className="rounded-full" />
            <SkeletonLine width={160} height={26} />
          </div>
          <SkeletonLine width="95%" height={54} />
          <SkeletonLine width={200} height={52} className="rounded-full" />
        </div>
        {/* The chart, as bars of the heights a week of traffic tends to make. */}
        <div className="flex min-h-[240px] items-end gap-4">
          {[62, 88, 45, 100, 71].map((height, index) => (
            <SkeletonLine key={index} width="100%" height={`${height}%`} />
          ))}
        </div>
      </SkeletonPanel>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <SkeletonPanel key={index}>
            <div className="flex flex-col gap-3">
              <SkeletonLine width={110} height={20} />
              <SkeletonLine width={170} height={58} />
              <SkeletonLine width="70%" height={20} />
            </div>
          </SkeletonPanel>
        ))}
      </div>

      <SkeletonPanel className="mt-5">
        <SkeletonHeading wide={280} />
        <div className="mt-6 flex flex-col gap-4">
          {[0, 1, 2, 3].map((index) => (
            <SkeletonRow key={index} />
          ))}
        </div>
      </SkeletonPanel>
    </SkeletonScreen>
  );
}
