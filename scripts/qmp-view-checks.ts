// Reading a QMP report against Ledger's own data.
//
// Two columns carry everything: var2 says whose row it is, var3 says which
// client. The rules worth pinning are that a row nobody here owns is never
// shown as if somebody did, that holding one back is counted rather than
// silent, and that an unknown client reads as a dash instead of borrowing a
// name from the row next to it.
//
//   npx tsx scripts/qmp-view-checks.ts
import { clientIndex, describeConversions, UNKNOWN_CLIENT } from '../src/lib/analytics';
import { joinReport } from '../src/lib/qmp-view';
import type { AffiliateLink, Conversion, Submission } from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

function link(slug: string, usr: string, assignee: string): AffiliateLink {
  return {
    id: `${slug}:${usr}`, slug, usr, assignee, assigneeEmail: '',
    destination: `https://example.test/?src=1&var2=${usr}`, campaign: 'Best Cards',
    headline: '', subheadline: '', ctaLabel: '', requirePhone: false, passUsrParam: '',
    active: true, notes: '', createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function submission(id: string, usr: string, fullName: string, email = ''): Submission {
  return {
    id, createdAt: '2026-08-02T00:00:00.000Z', slug: 'best-cards', usr,
    assignee: '', campaign: '', fullName, email, phone: '', destination: '',
    referrer: '', userAgent: '', ip: '', status: 'pending',
  };
}

function reportRow(var2: string, var3: string): Record<string, unknown> {
  return {
    'Date-Daily': '2026-08-12',
    'Card Name': 'Chase Sapphire Preferred',
    Var2: var2,
    Var3: var3,
    'Sub ID': 'JavaScriptTransition_JSWidget',
    Approvals: 1,
    'Total Earnings($)': '$100.00',
  };
}

const LINKS = [link('best-cards', 'yre648', 'Marsi'), link('best-cards', 'uxfs92', 'Emman Longos')];
const LEADS = [
  submission('rc7czk6xa61y', 'uxfs92', 'Emman'),
  submission('0huyap1emcju', 'yre648', 'MArsi Balisado'),
  submission('nonameatall00', 'yre648', '', 'quiet@example.test'),
];

console.log('— only rows with a live var2 —');
const mixed = joinReport({
  rows: [
    reportRow('yre648', '0huyap1emcju'),
    reportRow('nobody', 'whatever0000'),
    reportRow('uxfs92', 'rc7czk6xa61y'),
    reportRow('', ''),
  ],
  links: LINKS,
  submissions: LEADS,
});
check('the two known keys are kept', mixed.rows.length === 2);
check('the unknown key is held back', mixed.hidden === 2);
check('and named so it can be fixed', mixed.hiddenKeys.includes('nobody'));
check('an empty var2 is named too', mixed.hiddenKeys.includes('(empty)'));
check('order is preserved', mixed.resolved[0]?.usr === 'yre648' && mixed.resolved[1]?.usr === 'uxfs92');
check('rows and resolutions line up', mixed.rows.length === mixed.resolved.length);
// The one that matters: a held-back row must not shift the names by one and
// label somebody else's earnings with the wrong person.
check(
  'a held-back row does not shift the names',
  mixed.resolved[1]?.person === 'Emman Longos' && mixed.resolved[1]?.client === 'Emman',
);

console.log('\n— matching is forgiving about shape, strict about value —');
check('case is ignored', joinReport({ rows: [reportRow('YRE648', '')], links: LINKS, submissions: LEADS }).rows.length === 1);
check('padding is ignored', joinReport({ rows: [reportRow(' yre648 ', '')], links: LINKS, submissions: LEADS }).rows.length === 1);
check(
  'a longer key is not a match',
  joinReport({ rows: [reportRow('yre6480', '')], links: LINKS, submissions: LEADS }).hidden === 1,
);
check(
  'a prefix is not a match',
  joinReport({ rows: [reportRow('yre', '')], links: LINKS, submissions: LEADS }).hidden === 1,
);

console.log('\n— the client behind var3 —');
const named = joinReport({ rows: [reportRow('yre648', '0huyap1emcju')], links: LINKS, submissions: LEADS });
check('a known lead gives its name', named.resolved[0]?.client === 'MArsi Balisado');
const unknownLead = joinReport({ rows: [reportRow('yre648', 'nosuchlead00')], links: LINKS, submissions: LEADS });
check('an unknown lead is a dash', unknownLead.resolved[0]?.client === '-');
const noVar3 = joinReport({ rows: [reportRow('yre648', '')], links: LINKS, submissions: LEADS });
check('no var3 at all is a dash', noVar3.resolved[0]?.client === '-');
check('the row is still shown', noVar3.rows.length === 1);
check('and still names the person', noVar3.resolved[0]?.person === 'Marsi');
const nameless = joinReport({ rows: [reportRow('yre648', 'nonameatall00')], links: LINKS, submissions: LEADS });
check('a lead with no name falls back to its email', nameless.resolved[0]?.client === 'quiet@example.test');

console.log('\n— an affiliate only resolves their own leads —');
// The pages pass scoped data in. Somebody else's lead must not be nameable
// through a report row, or the client list leaks one name at a time.
const scoped = joinReport({
  rows: [reportRow('uxfs92', 'rc7czk6xa61y'), reportRow('yre648', '0huyap1emcju')],
  links: [LINKS[1]!],
  submissions: [LEADS[0]!],
});
check('their own row is shown', scoped.rows.length === 1);
check('with their own client named', scoped.resolved[0]?.client === 'Emman');
check("the other affiliate's row is held back", scoped.hidden === 1);

console.log('\n— empty inputs —');
const empty = joinReport({ rows: [], links: LINKS, submissions: LEADS });
check('no rows is not an error', empty.rows.length === 0 && empty.hidden === 0);
const noLinks = joinReport({ rows: [reportRow('yre648', '')], links: [], submissions: [] });
check('no links means nothing is shown', noLinks.rows.length === 0 && noLinks.hidden === 1);
check('a link with no usr is not a wildcard', joinReport({
  rows: [reportRow('anything', '')],
  links: [link('house', '', 'House')],
  submissions: [],
}).hidden === 1);

console.log('\n— the same rules on an approval —');
function conversion(notes: string, usr = 'yre648'): Conversion {
  return { id: notes, createdAt: '', approvedOn: '2026-08-12', slug: 'best-cards', usr, amount: 100, notes };
}
const described = describeConversions(
  LINKS,
  [
    conversion('Chase · qmp:abc1234#1/1 · lead:0huyap1emcju'),
    conversion('Chase · qmp:abc1235#1/1 · lead:nosuchlead00'),
    conversion('Chase · qmp:abc1236#1/1'),
    conversion('Typed in by hand'),
  ],
  LEADS,
);
check('a lead tag names the client', described[0]?.client === 'MArsi Balisado');
check('an unknown reference is a dash', described[1]?.client === UNKNOWN_CLIENT);
check('no reference is a dash', described[2]?.client === UNKNOWN_CLIENT);
check('a hand-typed approval is a dash', described[3]?.client === UNKNOWN_CLIENT);
check('the person still resolves', described.every((row) => row.person === 'Marsi'));
check('the machine tags are stripped for display', described[0]?.note === 'Chase');
check('a hand-typed note survives intact', described[3]?.note === 'Typed in by hand');
check(
  'without leads, every client is a dash rather than a crash',
  describeConversions(LINKS, [conversion('Chase · lead:0huyap1emcju')]).every(
    (row) => row.client === UNKNOWN_CLIENT,
  ),
);

console.log('\n— the client index —');
const index = clientIndex(LEADS);
check('it is keyed by lead reference', index.get('rc7czk6xa61y') === 'Emman');
check('an unknown reference is absent', index.get('nope') === undefined);
check('an empty reference is absent', index.get('') === undefined);
check(
  'a lead with neither name nor email is absent',
  clientIndex([submission('blankblank00', 'yre648', '')]).size === 0,
);

console.log(`\nqmp-view: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
