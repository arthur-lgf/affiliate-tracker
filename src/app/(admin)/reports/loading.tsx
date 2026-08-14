import { SkeletonLine, SkeletonPanel, SkeletonScreen } from '@/components/Skeleton';

/**
 * Reports.
 *
 * Only the page itself is drawn here. Running the report is a click, and a
 * click gets a spinner in the button that started it rather than a skeleton —
 * the screen is already there, and replacing it with grey blocks would throw
 * away the result you were just reading.
 */
export default function ReportsLoading() {
  return (
    <SkeletonScreen label="Loading reports">
      <SkeletonLine width={340} height={48} />
      <SkeletonLine width="70%" height={26} className="mt-4" />

      <SkeletonPanel className="mt-6">
        <SkeletonLine width={220} height={34} />
        <SkeletonLine width="60%" height={22} className="mt-3" />

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-2">
              <SkeletonLine width={90} height={20} />
              <SkeletonLine width="80%" height={24} />
            </div>
            <SkeletonLine width={260} height={28} />
            <div className="flex flex-wrap gap-5">
              <SkeletonLine width={200} height={64} className="rounded-[14px]" />
              <SkeletonLine width={200} height={64} className="rounded-[14px]" />
            </div>
            <div className="flex flex-wrap gap-4">
              <SkeletonLine width={170} height={60} className="rounded-full" />
              <SkeletonLine width={200} height={60} className="rounded-full" />
            </div>
          </div>
          <div className="panel-sunk flex flex-col gap-3 p-5">
            <SkeletonLine width={130} height={20} />
            {[0, 1, 2].map((index) => (
              <SkeletonLine key={index} height={22} />
            ))}
          </div>
        </div>
      </SkeletonPanel>
    </SkeletonScreen>
  );
}
