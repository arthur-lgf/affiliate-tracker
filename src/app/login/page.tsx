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

/** What the tool is, said once, for the panel beside the form. */
const COVERS = ['Links', 'Visits', 'Approvals', 'Earnings'];

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
      <div className="flex flex-col justify-between gap-10 bg-leaf px-6 py-10 text-white sm:px-10 lg:px-14 lg:py-14">
        <div className="flex items-center gap-3.5">
          <span aria-hidden className="h-9 w-9 flex-none rounded-full border-2 border-ink bg-gold" />
          <span className="font-display text-[30px] leading-none">Ledger</span>
        </div>

        <div className="hidden lg:block">
          <h2 className="font-display text-[clamp(2.25rem,4vw,3.25rem)] leading-[1.05]">
            Every click,
            <br />
            every approval,
            <br />
            <span className="text-gold">every payout.</span>
          </h2>
          <p className="mt-6 max-w-[420px] text-[21px] leading-relaxed text-leaf-edge">
            Affiliate links assigned to the people who own the traffic, with the earnings that came
            back from them.
          </p>
        </div>

        <ul className="flex flex-wrap gap-3">
          {COVERS.map((item) => (
            <li
              key={item}
              className="rounded-full border-2 border-leaf-edge/40 px-5 py-2.5 text-[18px] font-semibold text-leaf-edge"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* The form */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-10 lg:py-14">
        <div className="w-full max-w-[480px]">
          <p className="label-cap">Admin access</p>
          <h1 className="mt-4 font-display text-[clamp(2rem,5vw,2.875rem)] leading-[1.05]">
            Sign in to Ledger
          </h1>

          {configured ? (
            <>
              <p className="mt-4 text-[21px] leading-relaxed text-ink-soft">
                The dashboard holds what each person earned, so it asks who you are first.
              </p>

              <LoginForm next={next} />

              <p className="plain mt-8">
                Your username and password are set by whoever deployed this — there is no sign-up
                and no password reset here.
              </p>
            </>
          ) : (
            /* No password configured. Saying so beats a form that can only fail. */
            <>
              <p className="mt-4 text-[21px] leading-relaxed text-ink-soft">
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
