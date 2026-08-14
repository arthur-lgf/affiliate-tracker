import {
  SkeletonLine,
  SkeletonPanel,
  SkeletonPills,
  SkeletonRow,
  SkeletonScreen,
} from '@/components/Skeleton';

/** One person's page: the header with their initials, the hero, then the cards. */
export default function AffiliateLoading() {
  return (
    <SkeletonScreen label="Loading this person's earnings">
      <SkeletonLine width={200} height={52} className="rounded-full" />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
        <div className="flex min-w-0 items-center gap-5">
          <SkeletonLine width={80} height={80} className="flex-none rounded-full" />
          <div className="flex flex-col gap-3">
            <SkeletonLine width={260} height={44} />
            <SkeletonLine width={200} height={22} />
          </div>
        </div>
        <SkeletonPills />
      </div>

      <SkeletonPanel className="mt-5 grid gap-10 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <SkeletonLine width={230} height={20} />
          <SkeletonLine width="80%" height={72} />
          <SkeletonLine width={260} height={38} className="rounded-full" />
          <SkeletonLine width="95%" height={54} />
        </div>
        <div className="flex min-h-[240px] items-end gap-4">
          {[54, 80, 100, 63, 92].map((height, index) => (
            <SkeletonLine key={index} width="100%" height={`${height}%`} />
          ))}
        </div>
      </SkeletonPanel>

      <SkeletonPanel className="mt-5">
        <SkeletonLine width={220} height={34} />
        <div className="mt-5 flex flex-col gap-4">
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} disc={false} />
          ))}
        </div>
      </SkeletonPanel>

      {/* Their leads: a heading, the three status pills, then the list. */}
      <SkeletonPanel className="mt-5">
        <SkeletonLine width={260} height={34} />
        <div className="mt-5">
          <SkeletonPills />
        </div>
        <div className="mt-5 flex flex-col gap-4">
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} disc={false} />
          ))}
        </div>
      </SkeletonPanel>
    </SkeletonScreen>
  );
}
