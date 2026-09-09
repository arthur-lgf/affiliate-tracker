// Who may look through whose eyes.
//
// "View as client" hands an admin a session that reads, and writes, as somebody
// else. The rules deciding when that is allowed are the whole security surface
// of the feature, so they are pinned here rather than left to a review of the
// call sites.
//
// The one that matters most is that an affiliate can never do it. Everything
// else in this app scopes an affiliate to their own tracking key; if a forged or
// borrowed ticket let one of them adopt another key, this check is all that
// stood between them and every other affiliate's leads, names and earnings.
//
//   npx tsx scripts/view-as-checks.ts

// Set before anything reads it: signingSecret() consults the environment on
// every call, and createViewAsToken refuses outright without one, so a suite
// that forgot this would pass while proving nothing.
process.env.SESSION_SECRET = 'test-secret-not-a-real-key';

import { createSessionToken, readSessionToken } from '../src/lib/auth';
import {
  applyViewAs,
  createViewAsToken,
  readViewAsToken,
} from '../src/lib/impersonation';
import type { Viewer } from '../src/lib/viewer-core';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

const ADMIN: Viewer = {
  id: 'env:admin',
  username: 'admin',
  role: 'admin',
  usr: '',
  isEnvAdmin: true,
  open: false,
  actingAs: null,
};

const AFFILIATE: Viewer = {
  id: 'user-aff-1',
  username: 'dana',
  role: 'affiliate',
  usr: 'dana01',
  isEnvAdmin: false,
  open: false,
  actingAs: null,
};

const TARGET = { by: ADMIN.id, byName: ADMIN.username, uid: 'user-aff-9', user: 'sam', usr: 'sam99' };

async function main() {
  console.log('\n— the ticket itself —\n');

  const token = await createViewAsToken(TARGET);
  const ticket = await readViewAsToken(token);
  check('a fresh ticket reads back', ticket !== null);
  check('it names the account being viewed', ticket?.uid === 'user-aff-9' && ticket?.user === 'sam');
  check('it carries the tracking key the view is scoped to', ticket?.usr === 'sam99');
  check('it remembers the admin behind it', ticket?.by === ADMIN.id && ticket?.byName === 'admin');

  // Swap the payload for one naming a different key, keeping the old signature.
  // It no longer matches, which is the only thing between a cookie an affiliate
  // can edit and any tracking key they care to type.
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
      usr: 'someone-else',
    }),
  ).toString('base64url');
  check('a tampered payload is refused', (await readViewAsToken(`${forged}.${signature}`)) === null);

  const old = await createViewAsToken(TARGET, 1_000);
  check(
    'an expired ticket is refused',
    (await readViewAsToken(old, 1_000 + 30 * 24 * 3600 * 1000)) === null,
  );

  // An admin's usr is always ''. A ticket without one therefore names an admin
  // or nobody: the first would be a way to climb from admin to admin, the second
  // would scope to nothing while claiming to be somebody.
  const keyless = await createViewAsToken({ ...TARGET, usr: '' });
  check('a ticket with no tracking key is refused', (await readViewAsToken(keyless)) === null);

  console.log('\n— who is allowed to use one —\n');

  check(
    'an affiliate holding a valid ticket is still themselves',
    applyViewAs(AFFILIATE, ticket) === null,
  );
  check('a signed-out visitor holding one is nobody', applyViewAs(null, ticket) === null);
  check('an admin with no ticket is left alone', applyViewAs(ADMIN, null) === null);

  const acting = applyViewAs(ADMIN, ticket);
  check('an admin with a valid ticket is impersonating', acting !== null);
  check('they lose admin rights while looking', acting?.role === 'affiliate');
  check('self-or-admin checks resolve to the target', acting?.id === 'user-aff-9');
  check('scopeData filters on the target key', acting?.usr === 'sam99');
  check('the real admin stays on the record', acting?.actingAs?.adminId === ADMIN.id);
  check('and is named for the banner', acting?.actingAs?.adminName === 'admin');

  // Belt to the braces above: an already-impersonated viewer carries an
  // affiliate's role and is refused by the role check anyway.
  check('impersonation cannot be chained', applyViewAs(acting, ticket) === null);

  // A ticket belongs to the admin who minted it, not to admins in general.
  // Without this, admin A walks away mid-view, admin B signs in on the same
  // browser, and B silently becomes Sam while the banner still names A.
  const OTHER_ADMIN: Viewer = { ...ADMIN, id: 'user-admin-2', username: 'blair', isEnvAdmin: false };
  check(
    'another admin cannot pick up a ticket that is not theirs',
    applyViewAs(OTHER_ADMIN, ticket) === null,
  );

  console.log('\n— the two cookies are not interchangeable —\n');

  const session = await createSessionToken({
    uid: 'user-aff-9', user: 'sam', role: 'affiliate', usr: 'sam99', pwdAt: 0,
  });
  // Both are `payload.hmac` from the same secret, so the separation has to come
  // from the key derivation rather than from the payload shape.
  check('a view-as cookie does not open a session', (await readSessionToken(token)) === null);
  check('a session cookie does not grant a view-as', (await readViewAsToken(session)) === null);

  // A regression pin: adding a second token type touched how the HMAC key is
  // derived, and getting that wrong would sign everybody out.
  const readBack = await readSessionToken(session);
  check('ordinary sessions still verify', readBack?.usr === 'sam99');

  console.log(`\nview-as: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

void main();
