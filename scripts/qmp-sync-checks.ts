// Turning QMP rows into Ledger approvals.
//
// This decides what gets written into a money record, so the rules are pinned
// here: the approval count must survive, the earnings must add back up to the
// cent, nothing is attributed to a person by guesswork, and running it twice
// must not double anything.
//
//   npx tsx scripts/qmp-sync-checks.ts
import {
  leadsToRegister,
  leadRefIn,
  markerIn,
  normalizeKey,
  parseDate,
  parseNumber,
  planSync,
  readField,
  rowIdentity,
  splitAmount,
  visibleNotes,
} from '../src/lib/qmp-sync';
import type { AffiliateLink, Conversion } from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

function link(slug: string, usr: string, campaign = ''): AffiliateLink {
  return {
    id: slug, slug, usr, assignee: usr || 'House', assigneeEmail: '',
    destination: 'https://example.test', campaign, headline: '', subheadline: '',
    ctaLabel: '', requirePhone: false, passUsrParam: 'subid', active: true,
    notes: '', createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function conversion(notes: string): Conversion {
  return { id: notes, createdAt: '', approvedOn: '2026-08-01', slug: 's', usr: 'u', amount: 1, notes };
}

// The column labels exactly as QMP lists them in the report builder.
function qmpRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Date-Daily': '2026-08-12',
    'Placement Name': '25 Lets Get Funded - Organic Credit Cards',
    Advertiser: 'Chase',
    'Card Name': 'Chase Sapphire Preferred',
    'Device Type': 'Desktop',
    // Var2 carries the tracking key and Var3 the lead reference. Sub ID is
    // filled in with what the live report actually puts there — QuinStreet's
    // own widget name — so a test cannot pass by accidentally reading it.
    Var2: 'mark',
    Var3: 'rc7czk6xa61y',
    'Sub ID': 'JavaScriptTransition_JSWidget',
    'Referring Session URL': 'https://www.cardratings.com/bestcards',
    State: 'NY',
    Searches: 321,
    Clicks: 12,
    Applications: 4,
    Approvals: 3,
    'Avg. EPC($)': '1.25',
    'Total Earnings($)': '$412.50',
    Impressions: 900,
    'Click to App Rate(%)': '33.3',
    ...over,
  };
}

console.log('— column names —');
check('punctuation and case are ignored', normalizeKey('Total Earnings($)') === 'totalearnings');
check('a hyphen is ignored', normalizeKey('Date-Daily') === 'datedaily');
check('a space is ignored', normalizeKey('Sub ID') === 'subid');
check('a dot is ignored', normalizeKey('Avg. EPC($)') === 'avgepc');

const row = qmpRow();
check('the date column is found', readField(row, 'date') === '2026-08-12');
check('the var2 column is found', readField(row, 'var2') === 'mark');
check('the var3 column is found', readField(row, 'var3') === 'rc7czk6xa61y');
check('the approvals column is found', readField(row, 'approvals') === 3);
check('the earnings column is found', readField(row, 'earnings') === '$412.50');
check('the card column is found', readField(row, 'card') === 'Chase Sapphire Preferred');
check('a missing column is undefined', readField({}, 'approvals') === undefined);

console.log('\n— numbers —');
check('a plain number', parseNumber(3) === 3);
check('a numeric string', parseNumber('3') === 3);
check('a currency string', parseNumber('$412.50') === 412.5);
check('thousands separators', parseNumber('1,234.56') === 1234.56);
check('parentheses mean negative', parseNumber('(12.30)') === -12.3);
check('a leading minus', parseNumber('-12.30') === -12.3);
check('empty is null', parseNumber('') === null);
check('null is null', parseNumber(null) === null);
check('text is null', parseNumber('n/a') === null);
check('zero is zero, not null', parseNumber(0) === 0);
check('a zero string is zero', parseNumber('0') === 0);

console.log('\n— dates —');
check('ISO passes through', parseDate('2026-08-12') === '2026-08-12');
check('ISO with a time', parseDate('2026-08-12T00:00:00Z') === '2026-08-12');
check('US slashes are month first', parseDate('08/13/2026') === '2026-08-13');
check('single digit US', parseDate('8/3/2026') === '2026-08-03');
check('a written month', parseDate('13 Aug 2026') === '2026-08-13');
check('empty is empty', parseDate('') === '');
check('nonsense is empty', parseDate('not a date') === '');
check('a month over 12 is refused as slashes', parseDate('13/08/2026') !== '2026-13-08');

console.log('\n— splitting earnings —');
const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
check('one approval takes it all', splitAmount(412.5, 1).join() === '412.5');
check('an even split', splitAmount(400, 2).join() === '200,200');
check('an uneven split still adds up', sum(splitAmount(412.5, 3)) === 412.5);
check('the remainder goes to the front', splitAmount(1, 3).join() === '0.34,0.33,0.33');
check('three cents over seven ways adds up', sum(splitAmount(0.03, 7)) === 0.03);
check('zero earnings stay zero', splitAmount(0, 3).join() === '0,0,0');
check('no approvals means no amounts', splitAmount(100, 0).length === 0);
for (const [total, count] of [[412.5, 3], [0.01, 4], [99.99, 7], [1234.56, 11], [0.05, 2]] as const) {
  check(`${total} over ${count} adds back up`, sum(splitAmount(total, count)) === total);
  check(`${total} over ${count} yields ${count} amounts`, splitAmount(total, count).length === count);
}

console.log('\n— identity and markers —');
const identity = rowIdentity(row, '123');
check('identity is stable', rowIdentity(qmpRow(), '123') === identity);
check('a different report key changes it', rowIdentity(row, '456') !== identity);
check('a different day changes it', rowIdentity(qmpRow({ 'Date-Daily': '2026-08-11' }), '123') !== identity);
check('a different device changes it', rowIdentity(qmpRow({ 'Device Type': 'Mobile' }), '123') !== identity);
check('a different sub id changes it', rowIdentity(qmpRow({ 'Sub ID': 'dana' }), '123') !== identity);
check('a different var2 changes it', rowIdentity(qmpRow({ Var2: 'dana' }), '123') !== identity);
check('a different var3 changes it', rowIdentity(qmpRow({ Var3: 'zzzzzzzzzzzz' }), '123') !== identity);
// Measures are the payload, not the identity: yesterday's row gaining an
// approval must not read as a brand new row.
check('a changed measure does not change it', rowIdentity(qmpRow({ Approvals: 9, Searches: 1 }), '123') === identity);
check('a marker round trips', markerIn(`Chase · qmp:${identity}#2/3`) === `qmp:${identity}#2/3`);
check('a note with no marker reads null', markerIn('typed by hand') === null);
check('empty notes read null', markerIn('') === null);

console.log('\n— planning —');
const links = [link('cash-back', 'mark', 'Cash Back'), link('house-offer', '')];

const plan = planSync({ rows: [row], reportKey: '123', links, existing: [] });
check('3 approvals become 3 conversions', plan.create.length === 3);
check('the count is reported', plan.totalApprovals === 3);
check('the earnings are reported', plan.totalEarnings === 412.5);
check('the amounts add up to the row total', sum(plan.create.map((c) => c.amount)) === 412.5);
check('every conversion lands on the right link', plan.create.every((c) => c.slug === 'cash-back'));
check('the person is carried over', plan.create.every((c) => c.usr === 'mark'));
check('the date is carried over', plan.create.every((c) => c.approvedOn === '2026-08-12'));
check('the card is kept in the notes', plan.create[0]!.notes.startsWith('Chase Sapphire Preferred · '));
check('nothing is skipped on a first run', plan.skipped === 0);
check('no issues on a clean row', plan.issues.length === 0);

// The whole point of the marker.
const existing = plan.create.map((c) => conversion(c.notes));
const rerun = planSync({ rows: [row], reportKey: '123', links, existing });
check('a second run creates nothing', rerun.create.length === 0);
check('and says what it skipped', rerun.skipped === 3);

const partial = planSync({ rows: [row], reportKey: '123', links, existing: [existing[0]!] });
check('a half-imported row completes rather than repeats', partial.create.length === 2 && partial.skipped === 1);

// A row that grew after the first import: QMP restates approvals after the
// fact. Writing the new split alongside the old one would leave 7 conversions
// for 4 approvals and double the money, so this must refuse.
const grew = planSync({ rows: [qmpRow({ Approvals: 4, 'Total Earnings($)': '550.00' })], reportKey: '123', links, existing });
check('a restated row writes nothing', grew.create.length === 0);
check('and is reported as restated', grew.issues[0]?.kind === 'restated');
check('naming both counts', /3 approvals and QMP now says 4/.test(grew.issues[0]?.detail ?? ''));

const shrank = planSync({ rows: [qmpRow({ Approvals: 2, 'Total Earnings($)': '200.00' })], reportKey: '123', links, existing });
check('a shrunk row is caught too', shrank.create.length === 0 && shrank.issues[0]?.kind === 'restated');

const unchanged = planSync({ rows: [qmpRow({ 'Total Earnings($)': '500.00' })], reportKey: '123', links, existing });
check('the same count with new earnings is not a restatement', unchanged.issues.length === 0);
check('and is already imported, so nothing is written', unchanged.create.length === 0 && unchanged.skipped === 3);

// The tracking key travels in var2, written into the link's destination URL as
// var2=<usr>. Sub ID is not read at all any more: on the live report every row
// carries "JavaScriptTransition_JSWidget" there, which is QuinStreet's own
// widget name, and matching on it attributed every approval to nobody.
console.log('\n— the tracking key comes from var2 —');
check('var2 is what was matched', plan.create.every((c) => c.usr === 'mark'));
const subIdOnly = planSync({
  rows: [qmpRow({ Var2: '', 'Sub ID': 'mark' })],
  reportKey: '123',
  links: [links[0]!],
  existing: [],
});
check('a key in Sub ID alone is not used', subIdOnly.create.length === 0);
check('and is reported as unattributable', subIdOnly.issues[0]?.kind === 'no-link');
check(
  'the message names var2, not sub id',
  /var2/.test(subIdOnly.issues[0]?.detail ?? '') && !/Sub ID/.test(subIdOnly.issues[0]?.detail ?? ''),
);
check('case and padding are ignored', planSync({
  rows: [qmpRow({ Var2: '  MARK  ' })],
  reportKey: '123',
  links,
  existing: [],
}).create.every((c) => c.usr === 'mark'));

console.log('\n— the lead reference comes from var3 —');
check('it is carried onto the plan', plan.create.every((c) => c.leadRef === 'rc7czk6xa61y'));
check('and into the notes', plan.create.every((c) => c.notes.includes('lead:rc7czk6xa61y')));
check('where it can be read back', leadRefIn(plan.create[0]!.notes) === 'rc7czk6xa61y');
const noLead = planSync({ rows: [qmpRow({ Var3: '' })], reportKey: '123', links, existing: [] });
check('a row with no var3 still syncs', noLead.create.length === 3);
check('and carries no lead tag', noLead.create.every((c) => !c.notes.includes('lead:')));
check('which reads back as empty', leadRefIn(noLead.create[0]!.notes) === '');
// The marker still has to survive alongside the lead tag, or a re-run would
// write every one of these a second time.
check('the marker still round trips', markerIn(plan.create[0]!.notes) === plan.create[0]!.marker);
const withLead = planSync({
  rows: [row],
  reportKey: '123',
  links,
  existing: plan.create.map((c) => conversion(c.notes)),
});
check('a re-run recognises rows carrying a lead tag', withLead.create.length === 0 && withLead.skipped === 3);

console.log('\n— notes, as a person reads them —');
check('the tags come out', visibleNotes(plan.create[0]!.notes) === 'Chase Sapphire Preferred');
check('a hand-typed note is untouched', visibleNotes('Called them twice') === 'Called them twice');
check('a marker on its own leaves nothing', visibleNotes(`qmp:${identity}#1/3`) === '');
check('a lead tag on its own leaves nothing', visibleNotes('lead:rc7czk6xa61y') === '');
check('both on their own leave nothing', visibleNotes(`qmp:${identity}#1/3 · lead:rc7czk6xa61y`) === '');
check('empty notes stay empty', visibleNotes('') === '');
check('a card with a note keeps both', visibleNotes(`Chase · qmp:${identity}#1/3 · Called them`) === 'Chase · Called them');

console.log('\n— things that must not be guessed —');
const unknown = planSync({ rows: [qmpRow({ Var2: 'nobody' })], reportKey: '123', links, existing: [] });
check('an unknown var2 creates nothing', unknown.create.length === 0);
check('and is reported', unknown.issues[0]?.kind === 'no-link');
check('with the approvals at stake', unknown.issues[0]?.approvals === 3);

const houseRow = planSync({ rows: [qmpRow({ Var2: '' })], reportKey: '123', links, existing: [] });
check('an empty var2 uses the house link', houseRow.create.every((c) => c.slug === 'house-offer'));

const noHouse = planSync({ rows: [qmpRow({ Var2: '' })], reportKey: '123', links: [links[0]!], existing: [] });
check('with no house link it is reported, not dropped silently', noHouse.issues[0]?.kind === 'no-link');

const twoLinks = [link('a', 'mark', ''), link('b', 'mark', '')];
const ambiguous = planSync({ rows: [row], reportKey: '123', links: twoLinks, existing: [] });
check('two links on one var2 is ambiguous', ambiguous.issues[0]?.kind === 'ambiguous-link');
check('and nothing is written', ambiguous.create.length === 0);

const disambiguated = planSync({
  rows: [row],
  reportKey: '123',
  links: [link('a', 'mark', 'Chase Sapphire Preferred'), link('b', 'mark', 'Freedom Unlimited')],
  existing: [],
});
check('the card name can single one out', disambiguated.create.every((c) => c.slug === 'a'));

const undated = planSync({ rows: [qmpRow({ 'Date-Daily': 'whenever' })], reportKey: '123', links, existing: [] });
check('an unreadable date is reported', undated.issues[0]?.kind === 'no-date');
check('and nothing is written', undated.create.length === 0);

const clawback = planSync({ rows: [qmpRow({ 'Total Earnings($)': '-120.00' })], reportKey: '123', links, existing: [] });
check('negative earnings are refused', clawback.create.length === 0);
check('and called out as a reversal', clawback.issues[0]?.kind === 'negative-earnings');

const zero = planSync({ rows: [qmpRow({ Approvals: 0 })], reportKey: '123', links, existing: [] });
check('a row with no approvals is not an issue, just nothing', zero.create.length === 0 && zero.issues.length === 0);

const noColumn = planSync({ rows: [{ Clicks: 5, Searches: 9 }], reportKey: '123', links, existing: [] });
check('a report without Approvals is unusable', noColumn.unusable);
check('and says so once', noColumn.issues.length === 1 && noColumn.issues[0]!.kind === 'no-approvals-column');

console.log('\n— rows that differ only slightly —');
const twoDevices = planSync({
  rows: [qmpRow({ 'Device Type': 'Desktop' }), qmpRow({ 'Device Type': 'Mobile' })],
  reportKey: '123',
  links,
  existing: [],
});
check('two devices are two separate rows', twoDevices.create.length === 6);
check('their markers are all distinct', new Set(twoDevices.create.map((c) => c.notes)).size === 6);

// Genuinely identical rows: the occurrence suffix keeps the second one alive.
const duplicated = planSync({ rows: [qmpRow(), qmpRow()], reportKey: '123', links, existing: [] });
check('an exactly repeated row is not swallowed', duplicated.create.length === 6);
check('and its markers stay distinct', new Set(duplicated.create.map((c) => c.notes)).size === 6);

console.log('\n— what the row carried —');
// The plan keeps var2 as written as well as the link it matched, because the
// sync preview shows both and they are not always the same string.
check('var2 is kept beside the link it matched', plan.create.every((c) => c.trackingKey === 'mark'));

const shouted = planSync({
  rows: [qmpRow({ Var2: 'MARK', Approvals: 1, 'Total Earnings($)': 10 })],
  reportKey: '123',
  links,
  existing: [],
});
check('a differently cased var2 still matches', shouted.create.length === 1);
check('the link keeps its own spelling', shouted.create[0]!.usr === 'mark');
check('and the row keeps what it said', shouted.create[0]!.trackingKey === 'MARK');

// The one case where the two genuinely disagree: no key at all, placed on the
// default link anyway. Showing the blank is the point — it is the row a person
// should look at twice before writing.
const defaulted = planSync({
  rows: [qmpRow({ Var2: '', Approvals: 1, 'Total Earnings($)': 10 })],
  reportKey: '123',
  links: [link('cash-back', 'mark', 'Cash Back'), link('house-offer', 'house')],
  existing: [],
  defaultSlug: 'house-offer',
});
check('a keyless row lands on the default link', defaulted.create.length === 1);
check('under that link\'s person', defaulted.create[0]!.usr === 'house');
check('while var2 stays empty, as the report had it', defaulted.create[0]!.trackingKey === '');

console.log('\n— the leads behind an approval —');
/*
 * A lead is marked registered by hand once somebody confirms the signup. An
 * approval is that confirmation and a stronger one, so a lead left at pending
 * under an approval is a gap rather than a decision. These pin which leads the
 * sync closes and, just as importantly, which it leaves alone.
 */
const lead = (id: string, status: string) => ({ id, status });
const withRef = (ref: string) => ({ notes: `Chase Sapphire · qmp:ab12cd3#1/1 · lead:${ref}` });

const marks = leadsToRegister(
  [withRef('rc7czk6xa61y'), withRef('zz9maybe')],
  [lead('rc7czk6xa61y', 'pending'), lead('zz9maybe', 'registered'), lead('nobody', 'pending')],
);
check('a pending lead under an approval is marked', marks.includes('rc7czk6xa61y'));
check('a lead already registered is left alone', !marks.includes('zz9maybe'));
check('a lead with no approval is left alone', !marks.includes('nobody'));
check('and nothing else comes back', marks.length === 1);

// The reason this looks at every approval rather than the new ones: a second
// sync skips what it already imported, so the backlog is only ever reachable
// from the whole set.
const backlog = leadsToRegister([withRef('older')], [lead('older', 'pending')]);
check('an approval imported on an earlier run still closes its lead', backlog.length === 1);

check('an approval with no lead reference marks nothing',
  leadsToRegister([{ notes: 'Chase Sapphire · qmp:ab12cd3#1/1' }], [lead('rc7czk6xa61y', 'pending')]).length === 0);
check('a reference matching no lead marks nothing',
  leadsToRegister([withRef('deleted')], [lead('other', 'pending')]).length === 0);
check('no approvals at all marks nothing',
  leadsToRegister([], [lead('rc7czk6xa61y', 'pending')]).length === 0);
check('empty notes are not a reference',
  leadsToRegister([{ notes: '' }], [lead('rc7czk6xa61y', 'pending')]).length === 0);

// Three approvals off one row all carry the same reference; the lead is one
// lead and must be listed once, or the sync writes the same row three times.
const repeated = leadsToRegister(
  [withRef('rc7czk6xa61y'), withRef('rc7czk6xa61y'), withRef('rc7czk6xa61y')],
  [lead('rc7czk6xa61y', 'pending')],
);
check('one lead under three approvals is written once', repeated.length === 1);

console.log(`\nqmp-sync: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
