import { SkeletonLine, SkeletonPanel, SkeletonScreen } from '@/components/Skeleton';

/** People: the heading, the add form, then a row per account. */
export default function UsersLoading() {
  return (
    <SkeletonScreen label="Loading accounts">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="flex flex-col gap-3">
          <SkeletonLine width={260} height={48} />
          <SkeletonLine width={320} height={22} />
        </div>
        <SkeletonLine width={190} height={60} className="rounded-full" />
      </div>

      <SkeletonPanel className="mt-6">
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="card-row flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
              <SkeletonLine width={52} height={52} className="flex-none rounded-full" />
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <SkeletonLine width="35%" height={24} />
                <SkeletonLine width="22%" height={19} />
              </span>
              <SkeletonLine width={110} height={36} className="rounded-full" />
              <SkeletonLine width={130} height={52} className="rounded-full" />
              <SkeletonLine width={110} height={52} className="rounded-full" />
            </div>
          ))}
        </div>
      </SkeletonPanel>
    </SkeletonScreen>
  );
}
