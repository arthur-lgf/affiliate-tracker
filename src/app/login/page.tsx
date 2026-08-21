import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { authConfigured, readSessionToken, safeNextPath, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  // A sign-in page has no business in a search index.
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * What the tool holds, as four figures along the foot of the panel.
 *
 * Counts rather than a list of words: this page is the front door of a
 * reporting tool, and four numbers say what kind of tool it is faster than four
 * nouns do. They are deliberately not live — nothing signed out should be able
 * to read how much anybody earned — so they are the shape of the thing, not a
 * report.
 */
const COVERS: { label: string; value: string }[] = [
  { label: 'Links', value: 'Assigned' },
  { label: 'Visits', value: 'Counted' },
  { label: 'Approvals', value: 'Logged' },
  { label: 'Earnings', value: 'Split' },
];

export default async function LoginPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const next = safeNextPath(firstValue(query.next));

  // Already signed in — there is nothing to do here.
  const session = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (session) redirect(next);

  const configured = authConfigured();

  return (
    <main className="min-h-screen bg-paper lg:grid lg:min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      {/* The panel. On a phone it collapses to a band above the form rather
          than eating the first screenful. */}
      <div className="flex flex-col justify-between gap-10 bg-navy px-6 py-10 text-white sm:px-10 lg:px-11 lg:py-11">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="h-[18px] w-[18px] flex-none bg-gold" />
          <span className="text-[15px] font-semibold tracking-[0.02em]">Ledger</span>
        </div>

        <div className="hidden lg:block">
          <h2 className="max-w-[460px] text-[40px] font-semibold leading-[1.12] tracking-[-0.02em]">
            Every click, every approval, every payout.
          </h2>
          <p className="mt-4 max-w-[420px] text-[15px] leading-relaxed text-navy-soft">
            Affiliate links assigned to the people who own the traffic, with the earnings that came
            back from them.
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-navy-rule pt-5 sm:grid-cols-4">
          {COVERS.map((item) => (
            <li key={item.label}>
              <span className="tnum block text-[18px] font-medium">{item.value}</span>
              <span className="mt-1 block text-[11px] uppercase tracking-[0.08em] text-navy-dim">
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* The form */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-10 lg:py-14">
        <div className="panel w-full max-w-[380px] p-7">
          <p className="label-cap">Admin access</p>
          <h1 className="mt-2 text-[22px] font-semibold leading-[1.15]">Sign in to Ledger</h1>

          {configured ? (
            <>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
                The dashboard holds what each person earned, so it asks who you are first.
              </p>

              <LoginForm next={next} />
            </>
          ) : (
            /* No password configured. Saying so beats a form that can only fail. */
            <>
              <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
                No password is set on this deployment, so the dashboard is open and there is
                nothing to sign in to.
              </p>
              <div className="plain-note mt-6">
                Set <strong>ADMIN_PASSWORD</strong> (and optionally <strong>ADMIN_USER</strong>, which
                defaults to <strong>admin</strong>) and restart to turn sign-in on.
              </div>
              <Link href="/" className="btn-primary mt-8">
                Go to the dashboard
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
