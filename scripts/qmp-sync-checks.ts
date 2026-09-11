// Turning QMP rows into Ledger approvals.
//
// This decides what gets written into a money record, so the rules are pinned
// here: the approval count must survive, the earnings must add back up to the
// cent, nothing is attributed to a person by guesswork, and running it twice
// must not double anything.
//
//   npx tsx scripts/qmp-sync-checks.ts
import {
  applicationsByLead,
  approvedCards,
  approvedLeadIds,
  cardForLead,
  cardFromNotes,
  leadUpdateKind,
  leadUpdates,
  leadsToRegister,
  leadRefIn,
  markerIn,
  mergeCards,
  normalizeKey,
  parseDate,
  parseNumber,
  planSync,
  readField,
  rowIdentity,
  splitAmount,
  visibleNotes,
  writeLeadUpdates,
  type LeadUpdate,
} from '../src/lib/qmp-sync';
import { StoreConfigError } from '../src/lib/store/errors';
import type { AffiliateLink, Conversion, LeadStatus } from '../src/lib/types';

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

/*
 * The same references, read as a set rather than as a list of writes. This is
 * what the leads list reads to show a lead as approved without anybody running
 * a sync, so it has to answer for every approval on file, not just the new ones.
 */
const named = approvedLeadIds([withRef('rc7czk6xa61y'), withRef('zz9maybe'), { notes: 'typed by hand' }]);
check('every reference on file is named', named.has('rc7czk6xa61y') && named.has('zz9maybe'));
check('an approval entered by hand names nobody', named.size === 2);
check('a lead nothing points at is not named', !named.has('nobody'));
check('no approvals name nobody', approvedLeadIds([]).size === 0);
check(
  'three approvals for one lead name it once',
  approvedLeadIds([withRef('same'), withRef('same'), withRef('same')]).size === 1,
);
// The list of writes and the set of names have to agree, or the sheet says one
// thing and the screen says another.
check(
  'what gets written is what is named, minus the leads already approved',
  leadsToRegister([withRef('a'), withRef('b')], [lead('a', 'pending'), lead('b', 'registered')])
    .every((id) => approvedLeadIds([withRef('a'), withRef('b')]).has(id)),
);

console.log('\n— applications on the report —');
/*
 * The report counts applications as well as approvals. An application with no
 * approval yet is a lead that got as far as the merchant's form, which is
 * further than one that only filled in ours, so the sync marks it applied and
 * notes the card. These pin which rows name a lead, and what each says the
 * lead applied for.
 */
// One record from report 93440, keyed the way the API names its columns (the
// payload itself is pinned in qmp-checks). It is an application with no
// approval, so approvals is null rather than 0. The captured row says
// "Unknown" in var3; a real reference stands in for it here, and the captured
// value has checks of its own below.
function liveRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: '2026-08-10',
    source_name: '714025 Lets Get Funded - CC',
    advertiser: 'Bank of America',
    card_name: 'Bank of America(R) Business Advantage',
    device_type: 'Desktop',
    var2: 'Unknown',
    var3: 'rc7czk6xa61y',
    sub_id: 'JavaScriptTransition_JSWidget',
    session_ref_url: 'Unknown',
    state: 'Wisconsin',
    searches: null,
    clicks: null,
    applications: 1,
    approvals: null,
    avg_epc: null,
    total_earnings: null,
    impressions: null,
    ...over,
  };
}

const appliedOnly = applicationsByLead([liveRow()]);
check('an application with no approval names its lead', appliedOnly.has('rc7czk6xa61y'));
check('with the card it was for', appliedOnly.get('rc7czk6xa61y')?.join('|') === 'Bank of America(R) Business Advantage');
check('and names nobody else', appliedOnly.size === 1);
// The money side is unchanged by any of this: no approval, nothing written.
const noMoney = planSync({ rows: [liveRow({ var2: 'mark' })], reportKey: '123', links, existing: [] });
check('an application alone writes no approval', noMoney.create.length === 0 && noMoney.issues.length === 0);

// Widget traffic. The live report writes the word "Unknown" into var3 on rows
// that never came through a form here, and that is nobody's reference.
for (const placeholder of ['Unknown', 'unknown', '  UNKNOWN  ']) {
  check(
    `var3 "${placeholder.trim()}" names no lead`,
    applicationsByLead([liveRow({ var3: placeholder })]).size === 0,
  );
}
check('an empty var3 names no lead', applicationsByLead([liveRow({ var3: '' })]).size === 0);
check('a null var3 names no lead', applicationsByLead([liveRow({ var3: null })]).size === 0);
/*
 * var3 is text the visitor can edit on the way to the merchant, so a value is
 * only read as a lead when it has the shape of a reference Ledger mints (see
 * lib/lead-id.ts). A lead captured before references existed has a uuid for an
 * id and never travelled in a var3, so no report row can honestly name it, and
 * anything else in the column names nobody. This does not stop somebody who
 * already holds a real reference: see the note on applicationsByLead.
 */
const LEGACY_ID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
for (const notOurs of [LEGACY_ID, 'RC7CZK6XA61Y', 'rc7czk6xa61yz', 'rc7czk6xa6', 'rc7czk6x a61y', 'lead:rc7czk6xa61y']) {
  check(
    `var3 "${notOurs}" is not a reference Ledger mints, so it names no lead`,
    applicationsByLead([liveRow({ var3: notOurs })]).size === 0,
  );
}
check(
  'a reference with stray spaces round it is still read',
  applicationsByLead([liveRow({ var3: '  rc7czk6xa61y ' })]).has('rc7czk6xa61y'),
);
const captured = [
  liveRow({ var3: 'Unknown' }),
  liveRow({
    advertiser: 'American Express', card_name: 'Blue Business Cash Card', var3: 'Unknown',
    state: 'Texas', clicks: 2, approvals: 1, total_earnings: 240,
  }),
];
check('the report as captured names nobody', applicationsByLead(captured).size === 0);

check(
  'a row with neither an application nor an approval names nobody',
  applicationsByLead([liveRow({ applications: 0, clicks: 3 })]).size === 0,
);
check('nor does one where both are blank', applicationsByLead([liveRow({ applications: null })]).size === 0);
check('a count written as text is read', applicationsByLead([liveRow({ applications: '1' })]).size === 1);
check(
  'an approval counts as an application',
  applicationsByLead([liveRow({ applications: null, approvals: 1 })]).has('rc7czk6xa61y'),
);
const noAppsColumn = qmpRow();
delete noAppsColumn.Applications;
check('even on a report with no Applications column', applicationsByLead([noAppsColumn]).has('rc7czk6xa61y'));
check(
  "the report builder's labels are read too",
  applicationsByLead([qmpRow()]).get('rc7czk6xa61y')?.join('|') === 'Chase Sapphire Preferred',
);

const manyRows = applicationsByLead([
  liveRow(),
  liveRow({ card_name: 'Blue Business Cash Card', device_type: 'Mobile' }),
  liveRow({ date: '2026-08-11' }),
  liveRow({ card_name: '  Blue Business Cash Card  ' }),
]);
check('one lead across four rows is one entry', manyRows.size === 1);
check(
  'its cards are listed once each, in the order the report had them',
  manyRows.get('rc7czk6xa61y')?.join('|') === 'Bank of America(R) Business Advantage|Blue Business Cash Card',
);
const noCardName = applicationsByLead([liveRow({ card_name: '' })]);
check('a lead with no card name still counts', noCardName.has('rc7czk6xa61y'));
check('with no card to show for it', noCardName.get('rc7czk6xa61y')?.length === 0);
check('two leads are two entries', applicationsByLead([liveRow(), liveRow({ var3: 'zz9maybe0000' })]).size === 2);

console.log('\n— the card on an approval —');
/*
 * An approval keeps its card at the front of its notes, where the sync writes
 * it, and that is the only place Ledger has it. The card a lead was approved
 * for is read back from there, but only off notes the sync wrote: a note typed
 * by hand is whatever somebody typed, and its first words are not a card.
 */
check('a synced approval gives its card back', cardFromNotes(plan.create[0]!.notes) === 'Chase Sapphire Preferred');
check('every one of them does', plan.create.every((c) => cardFromNotes(c.notes) === c.card));
const cardless = planSync({ rows: [qmpRow({ 'Card Name': '' })], reportKey: '123', links, existing: [] });
check(
  'one synced with no card gives nothing back',
  cardless.create.length === 3 && cardless.create.every((c) => cardFromNotes(c.notes) === ''),
);
check('nor does a marker on its own', cardFromNotes(`qmp:${identity}#1/1`) === '');
check('a note typed by hand is not a card', cardFromNotes('Chase Sapphire') === '');
check('even one that looks like a synced note', cardFromNotes('Chase Sapphire · lead:rc7czk6xa61y') === '');
check('empty notes give nothing', cardFromNotes('') === '');
check(
  'a note added after the sync leaves the card alone',
  cardFromNotes(`Chase · qmp:${identity}#1/3 · Called them`) === 'Chase',
);

const byApproval = approvedCards(plan.create.map((c) => conversion(c.notes)));
check(
  'the lead behind synced approvals gets their card',
  byApproval.get('rc7czk6xa61y')?.join('|') === 'Chase Sapphire Preferred',
);
check('three approvals on one card list it once', byApproval.get('rc7czk6xa61y')?.length === 1);
const mixedApprovals = approvedCards([
  withRef('rc7czk6xa61y'),
  { notes: 'Blue Business Cash Card · qmp:ab12cd4#1/1 · lead:rc7czk6xa61y' },
  { notes: 'typed by hand' },
  { notes: 'Chase Sapphire · qmp:ab12cd5#1/1' },
]);
check(
  'two cards for one lead are both kept, in order',
  mixedApprovals.get('rc7czk6xa61y')?.join('|') === 'Chase Sapphire|Blue Business Cash Card',
);
check('an approval that names no lead adds nobody', mixedApprovals.size === 1);
check(
  'widget traffic names nobody',
  approvedCards([{ notes: 'Blue Business Cash Card · qmp:ab12cd6#1/1 · lead:Unknown' }]).size === 0,
);
check('no approvals, no cards', approvedCards([]).size === 0);

console.log('\n— adding cards to a lead —');
/*
 * The card on a lead only ever grows: each sync merges what it sees into what
 * is on record. So a merge with nothing new has to hand the record back exactly
 * as it was, because "did it change" is how the sync decides whether to write
 * at all. And the list needs a ceiling, or enough syncs could fill it forever.
 */
check('a first card is the whole list', mergeCards('', ['Chase']) === 'Chase');
check('a new card goes after the ones on record', mergeCards('Chase', ['Amex']) === 'Chase, Amex');
check('a card already on record is not added twice', mergeCards('Chase', ['Chase']) === 'Chase');
check('nor is one repeated in what came in', mergeCards('Chase', ['Amex', 'Amex', 'Chase']) === 'Chase, Amex');
check('stray spaces and blanks are ignored', mergeCards('', ['  Chase  ', '', '   ']) === 'Chase');
check('names are compared as QMP spells them', mergeCards('Chase', ['chase']) === 'Chase, chase');
check('nothing in, nothing out', mergeCards('', []) === '');
check('nothing new hands back the record exactly', mergeCards('Chase,Amex ', ['Chase,Amex']) === 'Chase,Amex ');
check(
  'a card whose own name has a comma is still recognised',
  mergeCards('Freedom, Unlimited', ['Freedom, Unlimited']) === 'Freedom, Unlimited',
);

const seven = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
check('at most five cards are kept, the first five', mergeCards('', seven) === 'A1, A2, A3, A4, A5');
check('a full list takes no more', mergeCards('A1, A2, A3, A4, A5', ['A6']) === 'A1, A2, A3, A4, A5');
const padded = (name: string, length: number) => name.padEnd(length, '.');
const longFour = mergeCards('', ['One', 'Two', 'Three', 'Four'].map((name) => padded(name, 60)));
check('the text stays within 200 characters', longFour.length <= 200);
check('by leaving out the name that would not fit', longFour.split(', ').length === 3);
check('a name longer than the ceiling is left out, not cut', mergeCards('', [padded('Huge', 250)]) === '');
check(
  'one that does not fit does not keep a shorter one out',
  mergeCards('', [padded('Big', 150), padded('Mid', 60), 'Amex']) === `${padded('Big', 150)}, Amex`,
);
const typedLong = padded('Typed by hand', 230);
check('a record already past the ceiling is kept as it is', mergeCards(typedLong, ['Amex']) === typedLong);

console.log('\n— the card a lead shows —');
/*
 * A lead approved before leads kept a card has none on record; its card
 * survives only on its approvals' notes. The leads list shows those rather
 * than a blank, and shows exactly what the next sync will write there, so the
 * cell does not change under anybody when the sync catches up.
 */
const approvalsForLead = [
  withRef('rc7czk6xa61y'),
  { notes: 'Blue Business Cash Card · qmp:ab12cd4#1/1 · lead:rc7czk6xa61y' },
  { notes: 'typed by hand' },
];
const cardsOnFile = approvedCards(approvalsForLead);
check(
  'a card on record is the card shown',
  cardForLead({ id: 'rc7czk6xa61y', card: 'Amex Gold' }, cardsOnFile) === 'Amex Gold',
);
check(
  'with none on record, the approvals say which',
  cardForLead({ id: 'rc7czk6xa61y', card: '' }, cardsOnFile) === 'Chase Sapphire, Blue Business Cash Card',
);
check(
  'a card of only spaces is none',
  cardForLead({ id: 'rc7czk6xa61y', card: '   ' }, cardsOnFile) === 'Chase Sapphire, Blue Business Cash Card',
);
check('a lead no approval names shows nothing', cardForLead({ id: 'nobody', card: '' }, cardsOnFile) === '');
const caughtUp = leadUpdates({
  conversions: approvalsForLead,
  applications: new Map(),
  submissions: [{ id: 'rc7czk6xa61y', status: 'registered', card: '' }],
});
check(
  'and what shows is what the next sync writes',
  caughtUp.length === 1 &&
    caughtUp[0]!.card === cardForLead({ id: 'rc7czk6xa61y', card: '' }, cardsOnFile),
);
const sevenApprovals = approvedCards(
  seven.map((name, i) => ({ notes: `${name} · qmp:ab12cd${i}#1/1 · lead:rc7czk6xa61y` })),
);
check(
  'held to the same five names a sync keeps',
  cardForLead({ id: 'rc7czk6xa61y', card: '' }, sevenApprovals) === 'A1, A2, A3, A4, A5',
);

console.log('\n— moving leads along —');
/*
 * What a sync does to a lead. An approval takes it to approved, an application
 * with no approval takes it to applied, and nothing takes it backwards: a
 * report can show an application without the approval that followed it, which
 * is a narrower view of the lead rather than news that it was un-approved.
 * Only leads that actually change come back, one entry each, because every
 * entry is a write to the store.
 */
const stored = (id: string, status: LeadStatus, card = '') => ({ id, status, card });
const apps = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

const moved = leadUpdates({
  conversions: [withRef('approvedlead')],
  applications: apps({ appliedlead0: ['Blue Business Cash Card'] }),
  submissions: [
    stored('approvedlead', 'pending'),
    stored('appliedlead0', 'pending'),
    stored('quietlead000', 'pending'),
  ],
});
const moveOf = (id: string) => moved.find((update) => update.id === id);
check('a pending lead under an approval moves to approved', moveOf('approvedlead')?.status === 'registered');
check('and says where it came from', moveOf('approvedlead')?.from === 'pending');
check('carrying the card off the approval', moveOf('approvedlead')?.card === 'Chase Sapphire');
check('a pending lead with an application moves to applied', moveOf('appliedlead0')?.status === 'applied');
check('carrying the card off the report', moveOf('appliedlead0')?.card === 'Blue Business Cash Card');
check('a lead nothing names is left alone', moveOf('quietlead000') === undefined);
check('and nothing else comes back', moved.length === 2);

const both = leadUpdates({
  conversions: [withRef('rc7czk6xa61y')],
  applications: apps({ rc7czk6xa61y: ['Chase Sapphire'] }),
  submissions: [stored('rc7czk6xa61y', 'pending')],
});
check('an approval outranks an application', both.length === 1 && both[0]!.status === 'registered');
check('and the card is not doubled between them', both[0]?.card === 'Chase Sapphire');

const onFromApplied = leadUpdates({
  conversions: [withRef('rc7czk6xa61y')],
  applications: new Map(),
  submissions: [stored('rc7czk6xa61y', 'applied', 'Chase Sapphire')],
});
check(
  'an applied lead moves on to approved',
  onFromApplied[0]?.status === 'registered' && onFromApplied[0]?.from === 'applied',
);
check('keeping the card it had', onFromApplied[0]?.card === 'Chase Sapphire');

// Forward only.
check(
  'an approved lead is never pulled back to applied',
  leadUpdates({
    conversions: [],
    applications: apps({ rc7czk6xa61y: ['Chase Sapphire'] }),
    submissions: [stored('rc7czk6xa61y', 'registered', 'Chase Sapphire')],
  }).length === 0,
);
const handApproved = leadUpdates({
  conversions: [],
  applications: apps({ rc7czk6xa61y: ['Chase Sapphire'] }),
  submissions: [stored('rc7czk6xa61y', 'registered')],
});
check('a lead approved by hand stays approved', handApproved[0]?.status === 'registered');
check('while the card the report shows is recorded', handApproved[0]?.card === 'Chase Sapphire');
check('which is a card change, not a move', handApproved[0]?.from === 'registered');

// Nothing comes back when nothing changes.
check(
  'an applied lead seen applying again is left alone',
  leadUpdates({
    conversions: [],
    applications: apps({ rc7czk6xa61y: ['Chase Sapphire'] }),
    submissions: [stored('rc7czk6xa61y', 'applied', 'Chase Sapphire')],
  }).length === 0,
);
check(
  'an approved lead under the same approval is left alone',
  leadUpdates({
    conversions: [withRef('rc7czk6xa61y')],
    applications: new Map(),
    submissions: [stored('rc7czk6xa61y', 'registered', 'Chase Sapphire')],
  }).length === 0,
);
check(
  'no report and no approvals change nothing',
  leadUpdates({ conversions: [], applications: new Map(), submissions: [stored('rc7czk6xa61y', 'pending')] })
    .length === 0,
);
check(
  'an application with no card changes nothing on a lead already applied',
  leadUpdates({
    conversions: [],
    applications: apps({ rc7czk6xa61y: [] }),
    submissions: [stored('rc7czk6xa61y', 'applied')],
  }).length === 0,
);
check(
  'but still moves a pending one',
  leadUpdates({
    conversions: [],
    applications: apps({ rc7czk6xa61y: [] }),
    submissions: [stored('rc7czk6xa61y', 'pending')],
  })[0]?.status === 'applied',
);

const secondCard = leadUpdates({
  conversions: [],
  applications: apps({ rc7czk6xa61y: ['Blue Business Cash Card'] }),
  submissions: [stored('rc7czk6xa61y', 'applied', 'Chase Sapphire')],
});
check('a second card is added to the first', secondCard[0]?.card === 'Chase Sapphire, Blue Business Cash Card');
check('without moving the status', secondCard[0]?.status === 'applied' && secondCard[0]?.from === 'applied');

// One entry per lead, however many rows and approvals name it.
const busyLead = leadUpdates({
  conversions: [withRef('rc7czk6xa61y'), withRef('rc7czk6xa61y'), withRef('rc7czk6xa61y')],
  applications: applicationsByLead([
    liveRow(),
    liveRow({ device_type: 'Mobile' }),
    liveRow({ card_name: 'Blue Business Cash Card' }),
  ]),
  submissions: [stored('rc7czk6xa61y', 'pending')],
});
check('one lead under three approvals and three rows is one entry', busyLead.length === 1);
check(
  'with every card it was seen with, once each',
  busyLead[0]?.card === 'Bank of America(R) Business Advantage, Blue Business Cash Card, Chase Sapphire',
);
check(
  'a lead listed twice in the store is written once',
  leadUpdates({
    conversions: [withRef('rc7czk6xa61y')],
    applications: new Map(),
    submissions: [stored('rc7czk6xa61y', 'pending'), stored('rc7czk6xa61y', 'pending')],
  }).length === 1,
);

// Things that must not move anybody.
check(
  'a reference that matches no lead moves nobody',
  leadUpdates({
    conversions: [withRef('deleted')],
    applications: apps({ deleted00000: ['Chase'] }),
    submissions: [stored('other', 'pending')],
  }).length === 0,
);
check(
  'the report as captured moves nobody',
  leadUpdates({
    conversions: [],
    applications: applicationsByLead(captured),
    submissions: [stored('rc7czk6xa61y', 'pending')],
  }).length === 0,
);
check(
  'an approval typed in by hand moves nobody',
  leadUpdates({
    conversions: [{ notes: 'typed by hand' }],
    applications: new Map(),
    submissions: [stored('rc7czk6xa61y', 'pending')],
  }).length === 0,
);
check(
  'a lead captured before references existed is not moved by a row naming its id',
  leadUpdates({
    conversions: [],
    applications: applicationsByLead([liveRow({ var3: LEGACY_ID })]),
    submissions: [stored(LEGACY_ID, 'pending')],
  }).length === 0,
);

// The narrower question and the whole answer have to agree about approvals,
// or the leads list and the sync would disagree about who is approved.
const everyone = [stored('a0', 'pending'), stored('b0', 'registered'), stored('c0', 'applied'), stored('d0', 'pending')];
const onFile = [withRef('a0'), withRef('b0'), withRef('c0')];
const toApproved = leadUpdates({ conversions: onFile, applications: apps({ d0: ['Amex'] }), submissions: everyone })
  .filter((update) => leadUpdateKind(update) === 'registered')
  .map((update) => update.id);
check('the moves to approved are exactly the leads leadsToRegister names',
  toApproved.join() === leadsToRegister(onFile, everyone).join());

// What each update is, for the counts on the Reports page.
check('a move to approved counts as one', leadUpdateKind({ id: 'x', from: 'pending', status: 'registered', card: '' }) === 'registered');
check('from applied as well', leadUpdateKind({ id: 'x', from: 'applied', status: 'registered', card: '' }) === 'registered');
check('a move to applied counts as one', leadUpdateKind({ id: 'x', from: 'pending', status: 'applied', card: 'Chase' }) === 'applied');
check('a status that stands is a card change', leadUpdateKind({ id: 'x', from: 'registered', status: 'registered', card: 'Chase' }) === 'card');
check('at either status', leadUpdateKind({ id: 'x', from: 'applied', status: 'applied', card: 'Chase, Amex' }) === 'card');

/*
 * Writing the moves. One lead that fails says nothing about the others, so the
 * rest are still tried. A store that is not set up for the write is different:
 * it fails every lead the same way, so it is said once, with the fix, and the
 * rest are not tried. That is a database whose migrations are behind the code,
 * which would otherwise put the same error on the Reports page once per lead,
 * on every sync, until somebody ran the migration.
 */
async function writingChecks(): Promise<void> {
  console.log('\n— writing the moves —');
  const toWrite: LeadUpdate[] = [
    { id: 'lead00000001', from: 'pending', status: 'registered', card: 'Chase Sapphire' },
    { id: 'lead00000002', from: 'pending', status: 'applied', card: 'Blue Business Cash Card' },
    { id: 'lead00000003', from: 'applied', status: 'applied', card: 'Amex Gold, Chase Sapphire' },
  ];
  const tried: string[] = [];
  const counts = (result: { written: Record<string, number> }) =>
    [result.written.registered, result.written.applied, result.written.card].join();

  const clean = await writeLeadUpdates(toWrite, async (update) => {
    tried.push(update.id);
  });
  check('every move is written, in order', tried.join() === 'lead00000001,lead00000002,lead00000003');
  check('and counted by kind', counts(clean) === '1,1,1');
  check('with nothing to report', clean.failures.length === 0);

  tried.length = 0;
  const oneBad = await writeLeadUpdates(toWrite, async (update) => {
    tried.push(update.id);
    if (update.id === 'lead00000002') {
      throw new Error('That row moved in the sheet while you were working on it.');
    }
  });
  check('one lead failing does not stop the rest', tried.length === 3);
  check('the rest are counted', counts(oneBad) === '1,0,1');
  check(
    'and the failure is one line naming its lead',
    oneBad.failures.length === 1 &&
      oneBad.failures[0] === 'lead lead00000002: That row moved in the sheet while you were working on it.',
  );

  tried.length = 0;
  const behind = await writeLeadUpdates(toWrite, async (update) => {
    tried.push(update.id);
    throw new StoreConfigError('The submissions table has no "card" column yet. Run: npx supabase db push');
  });
  check('a store that is not set up stops at the first lead', tried.length === 1);
  check('and says so once, not once per lead', behind.failures.length === 1);
  check(
    'with how many were not written and the fix',
    behind.failures[0] ===
      '3 lead updates were not written: The submissions table has no "card" column yet. Run: npx supabase db push',
  );
  check('and nothing counted as written', counts(behind) === '0,0,0');

  tried.length = 0;
  const partway = await writeLeadUpdates(toWrite, async (update) => {
    tried.push(update.id);
    if (update.id !== 'lead00000001') throw new StoreConfigError('Run: npx supabase db push');
  });
  check('a move that landed before it is still counted', counts(partway) === '1,0,0');
  check(
    'and only the ones left are counted as not written',
    partway.failures.length === 1 && partway.failures[0] === '2 lead updates were not written: Run: npx supabase db push',
  );

  const last = await writeLeadUpdates(toWrite.slice(0, 1), async () => {
    throw new StoreConfigError('Run: npx supabase db push');
  });
  check('one left reads as one', last.failures[0] === '1 lead update was not written: Run: npx supabase db push');

  const none = await writeLeadUpdates([], async () => {
    throw new Error('nothing should be written');
  });
  check('nothing to write writes nothing', counts(none) === '0,0,0' && none.failures.length === 0);
}

writingChecks()
  .catch((error) => {
    fail++;
    console.error('FAIL: the writing checks threw', error);
  })
  .finally(() => {
    console.log(`\nqmp-sync: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
