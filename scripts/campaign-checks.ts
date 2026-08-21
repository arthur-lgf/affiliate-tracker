// Campaigns, and the tracking key written into their URLs.
//
// This decides where a link sends people and which column an approval comes
// back matched on, so the rules worth pinning are the ones that would send
// traffic to the wrong place or attribute it to the wrong person: the
// merchant's own parameters must survive, var2 must not arrive twice, and a
// house link must not carry an empty key.
//
//   npx tsx scripts/campaign-checks.ts
import {
  defaultCampaigns,
  isSendableUrl,
  normalizeCampaigns,
  TRACKING_PARAM,
  withTrackingKey,
} from '../src/lib/campaigns';
import { campaignToCells, campaignsFromCells } from '../src/lib/store/campaign-row';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

const BASE = 'https://www.cardratings.com/bestcards?src=714025';

console.log('— writing the tracking key in —');
check('the column is var2', TRACKING_PARAM === 'var2');
check(
  'the key is appended to the merchant URL',
  withTrackingKey(BASE, 'arthur') === 'https://www.cardratings.com/bestcards?src=714025&var2=arthur',
);
check(
  "the merchant's own parameter survives",
  withTrackingKey(BASE, 'arthur').includes('src=714025'),
);
check(
  'a URL with no query gets one',
  withTrackingKey('https://example.com/offer', 'arthur') ===
    'https://example.com/offer?var2=arthur',
);

// Twice would let the merchant read either copy, and the two would disagree the
// moment a link is reassigned.
const already = withTrackingKey(`${BASE}&var2=someone-else`, 'arthur');
check('an existing key is replaced, not doubled', (already.match(/var2=/g) || []).length === 1);
check('and replaced with the right one', already.includes('var2=arthur'));

// A house link belongs to nobody. `var2=` empty would report against a tracking
// key that does not exist, which is worse than reporting against none.
check('a house link is left alone', withTrackingKey(BASE, '') === BASE);
check('nothing in, nothing out', withTrackingKey('', 'arthur') === '');
check('whitespace is not a URL', withTrackingKey('   ', 'arthur') === '');

// This runs on every keystroke behind a field somebody is still typing in.
check('a URL that will not parse is handed back untouched', withTrackingKey('https://', 'arthur') === 'https://');
// It goes through the URL parser, so it comes back as the parser writes it —
// a bare host gains its slash. Worth knowing before wondering why the saved
// URL is not character-for-character what Settings holds.
check('a parseable URL is normalised on the way through', withTrackingKey('https://exa', 'arthur') === 'https://exa/?var2=arthur');
check('so is something that is not a URL at all', withTrackingKey('cardratings', 'x') === 'cardratings');
check('the destination is trimmed on the way through', withTrackingKey(`  ${BASE}  `, '') === BASE);

// A key is url-safe by construction, but the encoder is what guarantees it.
check(
  'a key that needs encoding is encoded',
  withTrackingKey('https://example.com/o', 'a b&c').includes('var2=a+b%26c'),
);

console.log('\n— what counts as somewhere to send people —');
check('https is fine', isSendableUrl(BASE));
check('http is fine too', isSendableUrl('http://example.com'));
check('blank is not a destination', !isSendableUrl(''));
check('half a URL is not', !isSendableUrl('example.com/offer'));
// A javascript: URL in a field that becomes an href is the one that matters.
check('and neither is a javascript: url', !isSendableUrl('javascript:alert(1)'));
check('nor a file path', !isSendableUrl('file:///etc/passwd'));

console.log('\n— tidying the list —');
/*
 * Names are the key: a link stores the campaign name, and the form looks the
 * destination up by it. Two rows with one name would make which URL you get
 * depend on the order they happen to be in.
 */
const tidy = normalizeCampaigns([
  { name: '  Best Cards  ', destination: `  ${BASE}  ` },
  { name: '', destination: 'https://example.com' },
  { name: 'best cards', destination: 'https://example.com/other' },
  { name: 'Cash Back', destination: '' },
]);
check('names and URLs are trimmed', tidy[0]!.name === 'Best Cards' && tidy[0]!.destination === BASE);
check('a nameless row is dropped', tidy.every((row) => row.name !== ''));
check('a duplicate name is dropped, whatever its case', tidy.length === 2);
check('and the first one wins', tidy[0]!.destination === BASE);
check('a campaign with no URL is kept', tidy[1]!.name === 'Cash Back' && tidy[1]!.destination === '');
// The order is the only arrangement this list has — there is no sort key.
check('the order is left alone', tidy.map((row) => row.name).join() === 'Best Cards,Cash Back');

console.log('\n— the built-in fallback —');
const defaults = defaultCampaigns();
check('there are categories to fall back on', defaults.length > 20);
check('and none of them claims a URL', defaults.every((row) => row.destination === ''));
check('"Best Cards" is one of them', defaults.some((row) => row.name === 'Best Cards'));

console.log('\n— rows on disk and in the sheet —');
check('a campaign is two cells', campaignToCells({ name: 'Best Cards', destination: BASE }).length === 2);
const roundTrip = campaignsFromCells(
  [{ name: 'Best Cards', destination: BASE }, { name: 'Cash Back', destination: '' }].map(campaignToCells),
);
check('and survives the round trip', JSON.stringify(roundTrip) === JSON.stringify([
  { name: 'Best Cards', destination: BASE },
  { name: 'Cash Back', destination: '' },
]));
// A spreadsheet accumulates empty rows just by being scrolled in.
check('blank rows in the sheet are ignored', campaignsFromCells([['', ''], ['Best Cards', BASE], []]).length === 1);
check('a missing second cell reads as no URL', campaignsFromCells([['Best Cards']])[0]!.destination === '');

console.log(`\ncampaigns: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
