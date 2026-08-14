// The reference that follows a lead out to the merchant.
//
// This is the thread that ties an approval reported weeks later back to the
// person who filled the form, so the rules are pinned here: the merchant's own
// parameters must survive untouched, the reference must be the same string
// that is saved on the row, and it must never be attached to a forward that
// saved no row.
//
//   npx tsx scripts/lead-ref-checks.ts
import { leadIdParam } from '../src/lib/config';
import { isLeadId, newLeadId } from '../src/lib/lead-id';
import { destinationUrl } from '../src/lib/url';
import type { AffiliateLink } from '../src/lib/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

function link(over: Partial<AffiliateLink> = {}): AffiliateLink {
  return {
    id: 'l1', slug: 'bestcards', usr: 'mark', assignee: 'Mark', assigneeEmail: '',
    // The real shape: the merchant's own src, plus the placement id in var2.
    destination: 'https://www.cardratings.com/bestcards?src=714025&var2=1412',
    campaign: 'Best Cards', headline: '', subheadline: '', ctaLabel: '',
    requirePhone: false, passUsrParam: '', active: true, notes: '',
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}

const params = (url: string) => new URL(url).searchParams;

console.log('— the reference itself —');
const id = newLeadId();
check('it is 12 characters', id.length === 12);
check('lowercase letters and digits only', /^[a-z0-9]{12}$/.test(id));
check('it needs no url encoding', encodeURIComponent(id) === id);
check('it recognises itself', isLeadId(id));
check('a uuid is not one of ours', !isLeadId('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'));
check('a short string is not one', !isLeadId('abc'));
check('a long string is not one', !isLeadId('a'.repeat(13)));
check('uppercase is not one', !isLeadId('ABCDEFGHIJKL'));

const many = new Set(Array.from({ length: 5000 }, () => newLeadId()));
check('5000 in a row are all distinct', many.size === 5000);

console.log('\n— the outgoing url —');
const withLead = destinationUrl(link(), 'mark', { param: 'var3', id: 'abc123def456' });
check('var3 is appended', params(withLead).get('var3') === 'abc123def456');
check("the merchant's src survives", params(withLead).get('src') === '714025');
check('the placement in var2 survives', params(withLead).get('var2') === '1412');
check('the path is untouched', new URL(withLead).pathname === '/bestcards');
check('the host is untouched', new URL(withLead).host === 'www.cardratings.com');

// The reference is per person. A stale one already on the link must not win.
const preset = destinationUrl(
  link({ destination: 'https://www.cardratings.com/bestcards?src=714025&var3=stale' }),
  'mark',
  { param: 'var3', id: 'freshref1234' },
);
check('an existing var3 is replaced', params(preset).get('var3') === 'freshref1234');
check('and not duplicated', params(preset).getAll('var3').length === 1);

console.log('\n— alongside the assignee key —');
const both = destinationUrl(link({ passUsrParam: 'subid' }), 'mark', { param: 'var3', id: 'abc123def456' });
check('subid is still appended', params(both).get('subid') === 'mark');
check('and var3 alongside it', params(both).get('var3') === 'abc123def456');
check('with src intact', params(both).get('src') === '714025');
check('and var2 intact', params(both).get('var2') === '1412');

console.log('\n— when nothing should be added —');
check('no lead means the url is unchanged', destinationUrl(link(), 'mark') === link().destination);
check(
  'an empty param adds nothing',
  destinationUrl(link(), 'mark', { param: '', id: 'abc123def456' }) === link().destination,
);
check(
  'an empty id adds nothing',
  destinationUrl(link(), 'mark', { param: 'var3', id: '' }) === link().destination,
);
// A destination that is not a URL must forward as typed rather than throw.
check(
  'an unparseable destination is passed through',
  destinationUrl(link({ destination: 'not a url' }), 'mark', { param: 'var3', id: 'abc123def456' }) ===
    'not a url',
);

console.log('\n— which parameter —');
const previous = process.env.LEAD_ID_PARAM;
delete process.env.LEAD_ID_PARAM;
check('it defaults to var3', leadIdParam() === 'var3');
process.env.LEAD_ID_PARAM = 'var2';
check('it can be moved', leadIdParam() === 'var2');
process.env.LEAD_ID_PARAM = '  var3  ';
check('whitespace is trimmed', leadIdParam() === 'var3');
process.env.LEAD_ID_PARAM = '';
check('empty switches it off', leadIdParam() === '');
if (previous === undefined) delete process.env.LEAD_ID_PARAM;
else process.env.LEAD_ID_PARAM = previous;

console.log(`\nlead-ref: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
