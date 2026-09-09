// Run with:
//
//   npx tsx --test test/impersonation.test.mts
//
// Not plain node --test: the src/ imports are extensionless, which the bundler
// resolves and Node ESM does not, so that runner fails before a single case.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set before importing auth.ts: signingSecret() reads the environment on every
// call, and createSessionToken refuses outright without one, so a suite that
// forgot this would pass while proving nothing.
process.env.SESSION_SECRET = 'test-secret-not-a-real-key';

const { createSessionToken, readSessionToken } = await import('../src/lib/auth.ts');
const {
  applyViewAs,
  createViewAsToken,
  readViewAsToken,
  VIEW_AS_COOKIE,
} = await import('../src/lib/impersonation.ts');
// Built here rather than imported from viewer-core, which reaches the database
// layer through users.ts. The shape is what matters, and impersonation.ts only
// imports Viewer as a type, so nothing at runtime needs that chain.
const ADMIN = {
  id: 'env:admin',
  username: 'admin',
  role: 'admin' as const,
  usr: '',
  isEnvAdmin: true,
  open: false,
  actingAs: null,
};

/**
 * Who may look through whose eyes.
 *
 * "View as client" hands an admin a session that reads, and writes, as somebody
 * else. The rules deciding when that is allowed are the whole security surface
 * of the feature, so they are pinned here rather than left to a review of the
 * call sites.
 *
 * The one that matters most is that an affiliate can never do it. Everything
 * else in the app scopes an affiliate to their own tracking key; if a forged or
 * borrowed cookie let one of them adopt another key, this check is all that
 * stood between them and every other affiliate's leads and earnings.
 */

const AFFILIATE = {
  id: 'user-aff-1',
  username: 'dana',
  role: 'affiliate' as const,
  usr: 'dana01',
  isEnvAdmin: false,
  open: false,
  actingAs: null,
};

const TARGET = { by: ADMIN.id, byName: ADMIN.username, uid: 'user-aff-9', user: 'sam', usr: 'sam99' };

test('a ticket survives a round trip with every field intact', async () => {
  const token = await createViewAsToken(TARGET);
  const ticket = await readViewAsToken(token);
  assert.ok(ticket, 'a freshly minted ticket must read back');
  assert.equal(ticket.uid, 'user-aff-9');
  assert.equal(ticket.user, 'sam');
  assert.equal(ticket.usr, 'sam99');
  assert.equal(ticket.by, ADMIN.id);
  assert.equal(ticket.byName, ADMIN.username);
});

test('a tampered payload is refused', async () => {
  const token = await createViewAsToken(TARGET);
  const [payload, signature] = token.split('.');
  // Swap the payload for one naming a different key, keeping the old signature.
  // It no longer matches, which is the only thing between a cookie an affiliate
  // can edit and any tracking key they care to type.
  const forged = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
      usr: 'someone-else',
    }),
  ).toString('base64url');
  assert.equal(await readViewAsToken(`${forged}.${signature}`), null);
});

test('an expired ticket is refused', async () => {
  const token = await createViewAsToken(TARGET, 1_000);
  // Far past any sane window, so this does not depend on the configured length.
  assert.equal(await readViewAsToken(token, 1_000 + 30 * 24 * 3600 * 1000), null);
});

test('a ticket carrying no tracking key is refused', async () => {
  // An admin's usr is always ''. A ticket without a key therefore names either
  // an admin or nobody, and both are refused: viewing as an admin would be a way
  // to climb, and viewing as nobody would scope to nothing while claiming to be
  // somebody.
  const token = await createViewAsToken({ ...TARGET, usr: '' });
  assert.equal(await readViewAsToken(token), null);
});

test('an affiliate can never view as anyone, whatever cookie they present', async () => {
  const token = await createViewAsToken(TARGET);
  const ticket = await readViewAsToken(token);
  assert.ok(ticket);
  // A perfectly valid ticket presented by someone who is not an admin. This is
  // the check that keeps one affiliate out of another's data.
  assert.equal(applyViewAs(AFFILIATE, ticket), null);
});

test('a signed-out visitor can never view as anyone', async () => {
  const token = await createViewAsToken(TARGET);
  const ticket = await readViewAsToken(token);
  assert.ok(ticket);
  assert.equal(applyViewAs(null, ticket), null);
});

test('an admin adopts the target identity, and the real admin stays on the record', async () => {
  const token = await createViewAsToken(TARGET);
  const ticket = await readViewAsToken(token);
  assert.ok(ticket);

  const viewer = applyViewAs(ADMIN, ticket);
  assert.ok(viewer, 'an admin with a valid ticket is impersonating');
  assert.equal(viewer.role, 'affiliate', 'the admin must lose admin rights while looking');
  assert.equal(viewer.id, 'user-aff-9', 'self-or-admin checks must resolve to the target');
  assert.equal(viewer.username, 'sam');
  assert.equal(viewer.usr, 'sam99', 'scopeData filters on this');
  assert.equal(viewer.actingAs?.adminId, ADMIN.id, 'who to blame, and who to restore on exit');
  assert.equal(viewer.actingAs?.adminName, ADMIN.username);
});

test('with no ticket an admin is left exactly as they were', () => {
  assert.equal(applyViewAs(ADMIN, null), null);
});

test('the two token types cannot be swapped for one another', async () => {
  const viewAs = await createViewAsToken(TARGET);
  const session = await createSessionToken({
    uid: 'user-aff-9', user: 'sam', role: 'affiliate', usr: 'sam99', pwdAt: 0,
  });

  // Both are `payload.hmac` signed from the same secret, so the separation has
  // to come from the key derivation rather than from the payload shape.
  assert.equal(await readSessionToken(viewAs), null, 'a view-as cookie must not open a session');
  assert.equal(await readViewAsToken(session), null, 'a session cookie must not grant a view-as');
});

test('ordinary session tokens still verify', async () => {
  // A regression pin: adding a second token type touches how the HMAC key is
  // derived, and getting that wrong would sign everybody out.
  const token = await createSessionToken({
    uid: 'user-aff-1', user: 'dana', role: 'affiliate', usr: 'dana01', pwdAt: 0,
  });
  const session = await readSessionToken(token);
  assert.ok(session, 'existing sessions must keep working');
  assert.equal(session.usr, 'dana01');
});

test('the cookie is named distinctly from the session cookie', () => {
  assert.notEqual(VIEW_AS_COOKIE, 'ledger_session');
});
