import { SkeletonLine, SkeletonPanel, SkeletonScreen } from '@/components/Skeleton';

/**
 * The create form: the numbered steps down the left, the live preview rail on
 * the right. This one reads the accounts as well as the links, so it is the
 * slowest page in the app to arrive.
 */
export default function NewLinkLoading() {
  return (
    <SkeletonScreen label="Loading the create form">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <SkeletonLine width="60%" height={50} />
          <SkeletonLine width="85%" height={26} className="mt-4" />

          {[1, 2, 3].map((step) => (
            <SkeletonPanel key={step} className="mt-6">
              <div className="flex items-center gap-4">
                <SkeletonLine width={44} height={44} className="flex-none rounded-full" />
                <SkeletonLine width={220} height={32} />
              </div>
              <div className="mt-7 grid gap-6 sm:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <SkeletonLine width={130} height={20} />
                  <SkeletonLine height={64} className="rounded-[14px]" />
                </div>
                <div className="flex flex-col gap-3">
                  <SkeletonLine width={180} height={20} />
                  <SkeletonLine height={64} className="rounded-[14px]" />
                </div>
              </div>
            </SkeletonPanel>
          ))}

          <div className="mt-7 flex flex-wrap gap-5">
            <SkeletonLine width={220} height={68} className="rounded-full" />
            <SkeletonLine width={140} height={68} className="rounded-full" />
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <SkeletonPanel>
            <SkeletonLine width={200} height={20} />
            <SkeletonLine width="90%" height={30} className="mt-4" />
            <SkeletonLine width="75%" height={22} className="mt-4" />
          </SkeletonPanel>
          <SkeletonPanel>
            <SkeletonLine width={180} height={20} />
            <div className="mt-4 flex flex-col gap-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex items-center gap-3.5">
                  <SkeletonLine width={32} height={32} className="flex-none rounded-full" />
                  <SkeletonLine width="70%" height={20} />
                </div>
              ))}
            </div>
          </SkeletonPanel>
        </aside>
      </div>
    </SkeletonScreen>
  );
}
