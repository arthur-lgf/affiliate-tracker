import { NextResponse } from 'next/server';
import { QmpError, qmpConfig, qmpFetchToken } from '@/lib/qmp';
import { forbidden, unauthorized, viewerFromRequest } from '@/lib/api-auth';

/**
 * "Are the credentials good?" — one token call, nothing else.
 *
 * Worth having separately from the report route: when a report fails, this
 * says whether the credentials or the report key is at fault, which is the
 * first question every time.
 *
 * The token itself is never returned. What comes back is what the token says
 * about the account, which is what confirms you are pointed at the right one.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const viewer = await viewerFromRequest(request);
  if (!viewer) return unauthorized();
  if (viewer.role !== 'admin') return forbidden('Only an admin can use the reporting connection.');

  const config = qmpConfig();
  if (!config.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: 'QMP is not configured.',
        hint: 'Set QMP_API_KEY and QMP_API_SECRET in .env.local, then restart.',
      },
      { status: 503 },
    );
  }

  try {
    const token = await qmpFetchToken(config);
    return NextResponse.json({
      ok: true,
      baseUrl: config.baseUrl,
      app: config.app,
      userName: token.userName ?? null,
      permissions: token.permissions ?? null,
      expiresAt: new Date(token.expiresAt).toISOString(),
    });
  } catch (error) {
    if (error instanceof QmpError) {
      const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
      return NextResponse.json({ ok: false, error: error.message, hint: error.hint }, { status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'The check failed.' },
      { status: 502 },
    );
  }
}
