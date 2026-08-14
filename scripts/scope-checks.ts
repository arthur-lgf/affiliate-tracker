// Who sees which rows.
//
// This is the whole of the affiliate model in one function, so it is worth
// being blunt about what is being tested: if scopeData is wrong, one affiliate
// sees another affiliate's leads, names, phone numbers and earnings. Every case
// below is a way that could happen.
//
//   npx tsx scripts/scope-checks.ts
import { ownerForNewLink, ownsKey, scopeData, seesEverything } from '../src/lib/scope';
import type { Viewer } from '../src/lib/viewer-core';
import type { AffiliateLink, Conversion, Submission, Visit } from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

function viewer(over: Partial<Viewer>): Viewer {
  return {
    id: 'u1',
    username: 'someone',
    role: 'affiliate',
    usr: 'arthur',
    isEnvAdmin: false,
    open: false,
    ...over,
  };
}

const ADMIN = viewer({ id: 'a1', username: 'admin', role: 'admin', usr: '' });
const ARTHUR = viewer({ usr: 'arthur', username: 'arthur' });
const BIANCA = viewer({ id: 'u2', usr: 'bianca', username: 'bianca' });

function link(usr: string, id: string): AffiliateLink {
  return {
    id,
    slug: 'cash-back',
    usr,
    assignee: usr || 'House',
    assigneeEmail: '',
    destination: 'https://example.test',
    campaign: 'Cash Back',
    headline: '',
    subheadline: '',
    ctaLabel: '',
    requirePhone: false,
    passUsrParam: 'subid',
    active: true,
    notes: '',
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function submission(usr: string, id: string): Submission {
  return {
    id,
    createdAt: '2026-08-01T00:00:00.000Z',
    slug: 'cash-back',
    usr,
    assignee: '',
    campaign: '',
    fullName: 'Priya Nair',
    email: 'priya@example.test',
    phone: '555-0100',
    destination: '',
    referrer: '',
    userAgent: '',
    ip: '',
    status: 'pending',
  };
}

function visit(usr: string, id: string): Visit {
  return {
    id,
    createdAt: '2026-08-01T00:00:00.000Z',
    slug: 'cash-back',
    usr,
    referrer: '',
    userAgent: '',
    ip: '',
  };
}

function conversion(usr: string, id: string, amount: number): Conversion {
  return {
    id,
    createdAt: '2026-08-01T00:00:00.000Z',
    approvedOn: '2026-08-01',
    slug: 'cash-back',
    usr,
    amount,
    notes: '',
  };
}

/** One row per owner, including a house row that belongs to nobody. */
const DATA = {
  links: [link('arthur', 'l1'), link('bianca', 'l2'), link('', 'l3')],
  submissions: [submission('arthur', 's1'), submission('bianca', 's2'), submission('', 's3')],
  visits: [visit('arthur', 'v1'), visit('bianca', 'v2'), visit('', 'v3')],
  conversions: [
    conversion('arthur', 'c1', 100),
    conversion('bianca', 'c2', 250),
    conversion('', 'c3', 40),
  ],
};

function main() {
  console.log('— an admin sees everything —');
  const asAdmin = scopeData(DATA, ADMIN);
  check('every link', asAdmin.links.length === 3);
  check('every lead', asAdmin.submissions.length === 3);
  check('every visit', asAdmin.visits.length === 3);
  check('every approval', asAdmin.conversions.length === 3);
  check('seesEverything agrees', seesEverything(ADMIN));

  console.log('\n— an affiliate sees only their own —');
  const asArthur = scopeData(DATA, ARTHUR);
  check('only their link', asArthur.links.length === 1 && asArthur.links[0]!.usr === 'arthur');
  check('only their lead', asArthur.submissions.length === 1 && asArthur.submissions[0]!.id === 's1');
  check('only their visit', asArthur.visits.length === 1 && asArthur.visits[0]!.id === 'v1');
  check('only their approval', asArthur.conversions.length === 1 && asArthur.conversions[0]!.id === 'c1');

  // The one that matters most: a lead row carries a real person's name, email
  // and phone number.
  check(
    "no trace of another affiliate's lead",
    !JSON.stringify(asArthur).includes('s2') && asArthur.submissions.every((r) => r.usr === 'arthur'),
  );
  check(
    "no trace of another affiliate's money",
    asArthur.conversions.every((r) => r.amount !== 250),
  );

  console.log('\n— house rows belong to nobody, so no affiliate gets them —');
  check('no house link', asArthur.links.every((r) => r.usr !== ''));
  check('no house lead', asArthur.submissions.every((r) => r.usr !== ''));
  check('no house visit', asArthur.visits.every((r) => r.usr !== ''));
  check('no house approval', asArthur.conversions.every((r) => r.usr !== ''));

  console.log('\n— the two affiliates never overlap —');
  const asBianca = scopeData(DATA, BIANCA);
  check('bianca gets her own', asBianca.links.length === 1 && asBianca.links[0]!.usr === 'bianca');
  const arthurIds = new Set(asArthur.submissions.map((r) => r.id));
  check(
    'and none of arthur’s',
    asBianca.submissions.every((r) => !arthurIds.has(r.id)),
  );

  console.log('\n— failing closed —');
  // A caller that reaches here without a viewer has a bug. The safe reading of
  // "I do not know who this is" is "they see nothing", never "they see all".
  const asNobody = scopeData(DATA, null);
  check('no viewer sees no links', asNobody.links.length === 0);
  check('no viewer sees no leads', asNobody.submissions.length === 0);
  check('no viewer sees no visits', asNobody.visits.length === 0);
  check('no viewer sees no approvals', asNobody.conversions.length === 0);
  check('and is not mistaken for an admin', !seesEverything(null));

  // An affiliate whose key is somehow blank must not fall through to "no
  // filter". This is the exact shape of the bug that leaks everything.
  const keyless = scopeData(DATA, viewer({ usr: '' }));
  check('an affiliate with no key sees nothing', keyless.links.length === 0);
  check('and no leads', keyless.submissions.length === 0);
  check('and no approvals', keyless.conversions.length === 0);

  console.log('\n— the input is not mutated —');
  check('the source still holds every link', DATA.links.length === 3);
  check('the source still holds every lead', DATA.submissions.length === 3);

  console.log('\n— ownsKey —');
  check('an admin owns any key', ownsKey(ADMIN, 'bianca'));
  check('an admin owns the house key', ownsKey(ADMIN, ''));
  check('an affiliate owns their own', ownsKey(ARTHUR, 'arthur'));
  check("an affiliate does not own another's", !ownsKey(ARTHUR, 'bianca'));
  check('an affiliate does not own the house key', !ownsKey(ARTHUR, ''));
  check('nobody owns anything', !ownsKey(null, 'arthur'));
  check('a keyless affiliate owns nothing', !ownsKey(viewer({ usr: '' }), ''));
  // Prefix and case games: 'arthur' must not match 'arthur2' or 'Arthur'.
  check('a longer key is not owned', !ownsKey(ARTHUR, 'arthur2'));
  check('a differently cased key is not owned', !ownsKey(ARTHUR, 'Arthur'));

  // An affiliate may now create links, which means the request body carries a
  // `usr` written by somebody with an interest in what it says. Every case here
  // is a way that field could end up deciding who gets paid.
  console.log('\n— who a new link belongs to —');
  const SELF = { fullName: 'Arthur Reed', email: 'arthur@example.test', username: 'arthur' };
  const asked = { usr: 'bianca', assignee: 'Bianca Vale', assigneeEmail: 'bianca@example.test' };

  const adminChoice = ownerForNewLink(ADMIN, asked, null);
  check('an admin creates for whoever they named', adminChoice.ok && adminChoice.owner.usr === 'bianca');
  const houseChoice = ownerForNewLink(ADMIN, { usr: '', assignee: '', assigneeEmail: '' }, null);
  check('an admin may still make a house link', houseChoice.ok && houseChoice.owner.usr === '');

  // The one that matters: what was asked for is ignored entirely.
  const mine = ownerForNewLink(ARTHUR, asked, SELF);
  check('an affiliate gets their own key', mine.ok && mine.owner.usr === 'arthur');
  check("and not the one they asked for", mine.ok && mine.owner.usr !== 'bianca');
  check('with their own name on it', mine.ok && mine.owner.assignee === 'Arthur Reed');
  check("and not somebody else's", mine.ok && mine.owner.assignee !== 'Bianca Vale');

  // An affiliate cannot make a house link either. House rows are what an
  // unattributed click falls back to, so they belong to nobody in particular.
  const asHouse = ownerForNewLink(ARTHUR, { usr: '', assignee: '', assigneeEmail: '' }, SELF);
  check('an affiliate cannot make a house link', asHouse.ok && asHouse.owner.usr === 'arthur');

  // The email is theirs to write, because it is a note about their own row.
  const typedEmail = ownerForNewLink(
    ARTHUR,
    { usr: '', assignee: '', assigneeEmail: 'work@example.test' },
    SELF,
  );
  check('a typed email is kept', typedEmail.ok && typedEmail.owner.assigneeEmail === 'work@example.test');
  const blankEmail = ownerForNewLink(ARTHUR, { usr: '', assignee: '', assigneeEmail: '' }, SELF);
  check(
    'and their account email is the default',
    blankEmail.ok && blankEmail.owner.assigneeEmail === 'arthur@example.test',
  );

  // The account lookup is best effort, so the fallbacks have to hold.
  const noAccount = ownerForNewLink(ARTHUR, asked, null);
  check('no account row still binds the key', noAccount.ok && noAccount.owner.usr === 'arthur');
  check('and falls back to the username', noAccount.ok && noAccount.owner.assignee === 'arthur');
  const namelessAccount = ownerForNewLink(ARTHUR, asked, { fullName: '', email: '', username: 'arthur' });
  check(
    'an account with no full name uses the username',
    namelessAccount.ok && namelessAccount.owner.assignee === 'arthur',
  );

  console.log('\n— and failing closed —');
  check('nobody creates nothing', !ownerForNewLink(null, asked, SELF).ok);
  check(
    'an affiliate with no key is refused',
    !ownerForNewLink(viewer({ usr: '' }), asked, SELF).ok,
  );

  console.log(`\nscope: ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main();
