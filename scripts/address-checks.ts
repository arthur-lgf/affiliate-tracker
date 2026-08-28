// The affiliate's address, in the parts a US form asks for.
//
// Two things here end up on a signed contract, so they are the ones worth
// pinning. The line the document prints is composed from the parts and must
// never contain a line break, because the PDF draws it as one field beside its
// label. And the parser that reads an older free-text address back into the
// form must never drop any of it: a form that silently loses half of somebody's
// address is worse than one that gives up and leaves it all in line 1.
//
//   npx tsx scripts/address-checks.ts
import {
  addressFrom,
  addressProblems,
  cityStateZip,
  emptyAddress,
  formatAddress,
  hasAddress,
  isStateCode,
  parseAddress,
  stateName,
  tidyAddress,
  US_STATES,
  ZIP,
} from '../src/lib/address';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name, extra === undefined ? '' : extra);
  }
}

const AUSTIN = {
  line1: '1 Example Street',
  line2: 'Apt 4',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
};

console.log('— the list of states —');
check('every state, the District and the territories', US_STATES.length === 56);
check('codes are unique', new Set(US_STATES.map((s) => s.code)).size === US_STATES.length);
check('and are all two letters', US_STATES.every((s) => /^[A-Z]{2}$/.test(s.code)));
check('names are unique too', new Set(US_STATES.map((s) => s.name)).size === US_STATES.length);
check('Texas is on it', isStateCode('TX') && stateName('TX') === 'Texas');
// A territory is not an afterthought: somebody in San Juan files a W-9.
check('so is Puerto Rico', isStateCode('PR'));
check('so is the District', isStateCode('DC'));
check('a lower-case code still resolves', isStateCode('tx') && stateName('tx') === 'Texas');
check('spaces do not stop it', isStateCode('  ny  '));
check('a name is not a code', !isStateCode('Texas'));
check('nor is a made-up pair', !isStateCode('XX'));
check('an unknown code has no name', stateName('XX') === '');

console.log('\n— the line the agreement prints —');
check('street, apartment, then city state ZIP', formatAddress(AUSTIN) === '1 Example Street, Apt 4, Austin, TX 78701');
check('no apartment leaves no gap', formatAddress({ ...AUSTIN, line2: '' }) === '1 Example Street, Austin, TX 78701');
/*
 * The one that would show up in a signed contract. The PDF draws this beside a
 * label at a fixed x, so a newline would come out as a stray glyph or as a lost
 * half of the address.
 */
check('it is one line, always', !formatAddress(AUSTIN).includes('\n'));
// The form cannot produce a newline, since these are inputs rather than a text
// box. The endpoint behind it takes whatever it is sent, and what it is sent
// gets drawn on a contract.
check(
  'a newline sent by something other than the form is flattened',
  !formatAddress({ ...AUSTIN, line2: 'Apt\n4' }).includes('\n') &&
    formatAddress({ ...AUSTIN, line2: 'Apt\n4' }).includes('Apt 4'),
  formatAddress({ ...AUSTIN, line2: 'Apt\n4' }),
);
check('and so is a tab', tidyAddress({ city: 'San\tJuan' }).city === 'San Juan');
check('an empty address composes to nothing', formatAddress(emptyAddress()) === '');
check('and nothing is not an address', !hasAddress(emptyAddress()));
check('but a street alone is', hasAddress({ ...emptyAddress(), line1: '1 Example Street' }));

console.log('\n— city, state and ZIP together —');
check('the usual shape', cityStateZip(AUSTIN) === 'Austin, TX 78701');
check('a city on its own keeps no comma', cityStateZip({ city: 'Austin' }) === 'Austin');
check('a state and ZIP without a city keep no comma', cityStateZip({ state: 'TX', postalCode: '78701' }) === 'TX 78701');
check('an empty one is empty', cityStateZip(emptyAddress()) === '');

console.log('\n— tidying —');
check('everything is trimmed', tidyAddress({ line1: '  1 Example Street ', city: ' Austin ' }).line1 === '1 Example Street');
check('the state is upper-cased', tidyAddress({ state: 'tx' }).state === 'TX');
check('missing parts become empty strings', tidyAddress(null).city === '');

console.log('\n— what has to be filled in —');
check('a whole address has no problems', Object.keys(addressProblems(AUSTIN)).length === 0);
check('a missing street is caught', Boolean(addressProblems({ ...AUSTIN, line1: '' }).addressLine1));
check('a missing city is caught', Boolean(addressProblems({ ...AUSTIN, city: '' }).addressCity));
check('an unpicked state is caught', Boolean(addressProblems({ ...AUSTIN, state: '' }).addressState));
check('a state that is not one is caught', Boolean(addressProblems({ ...AUSTIN, state: 'XX' }).addressState));
check('a missing ZIP is caught', Boolean(addressProblems({ ...AUSTIN, postalCode: '' }).addressPostalCode));
check('a four-digit ZIP is caught', Boolean(addressProblems({ ...AUSTIN, postalCode: '7870' }).addressPostalCode));
check('a ZIP with letters is caught', Boolean(addressProblems({ ...AUSTIN, postalCode: '7870A' }).addressPostalCode));
check('ZIP+4 is fine', Object.keys(addressProblems({ ...AUSTIN, postalCode: '78701-1234' })).length === 0);
// Most addresses have no second line, and requiring one would mean requiring
// people to invent an apartment number.
check('no apartment is not a problem', Object.keys(addressProblems({ ...AUSTIN, line2: '' })).length === 0);
check('the ZIP shape is the only two USPS writes', ZIP.test('78701') && ZIP.test('78701-1234') && !ZIP.test('787011234'));

console.log('\n— reading an address written before the fields existed —');
const full = parseAddress('1 Example Street, Apt 4, Austin, TX 78701');
check('the street lands on line 1', full.line1 === '1 Example Street', full);
check('the apartment lands on line 2', full.line2 === 'Apt 4', full);
check('the city is found', full.city === 'Austin', full);
check('the state is found', full.state === 'TX', full);
check('the ZIP is found', full.postalCode === '78701', full);

const noComma = parseAddress('1 Example Street, Austin TX 78701');
check('a city and state with no comma between them still split', noComma.city === 'Austin' && noComma.state === 'TX', noComma);
check('and the street survives it', noComma.line1 === '1 Example Street', noComma);

const lines = parseAddress('1 Example Street\nAustin, TX 78701');
check('a newline works like a comma', lines.line1 === '1 Example Street' && lines.city === 'Austin', lines);

const spaced = parseAddress('1 Example Street, Austin, TX, 78701');
check('a comma before the ZIP does not lose the state', spaced.state === 'TX' && spaced.postalCode === '78701', spaced);

const plus4 = parseAddress('1 Example Street, Austin, TX 78701-1234');
check('ZIP+4 is read whole', plus4.postalCode === '78701-1234', plus4);

/*
 * The rule that matters most. Anything unparseable stays where the person can
 * see it and move it, rather than being quietly thrown away.
 */
const junk = parseAddress('Testsda');
check('an address that is not one keeps all of itself', junk.line1 === 'Testsda', junk);
const halfKnown = parseAddress('Somewhere in the hills');
check('so does prose', halfKnown.line1 === 'Somewhere in the hills', halfKnown);
const notAState = parseAddress('1 Example Street, Austin, ZZ 78701');
check('a two-letter word that is not a state is not treated as one', notAState.state === '', notAState);
check('and nothing is dropped when that happens', formatAddress(notAState).includes('Austin') && formatAddress(notAState).includes('ZZ 78701'), notAState);
check('an empty string parses to an empty address', formatAddress(parseAddress('')) === '');

console.log('\n— which address a stored agreement shows —');
check('the parts win when they are there', addressFrom(AUSTIN, 'something else entirely').city === 'Austin');
check(
  'the old line is read when the parts are empty',
  addressFrom(emptyAddress(), '1 Example Street, Austin, TX 78701').city === 'Austin',
);
check('and an empty row gives an empty form', formatAddress(addressFrom(emptyAddress(), '')) === '');

/*
 * A round trip. What the form collects, composes and reads back must survive
 * the journey, or somebody re-signing would find their own address changed.
 */
const round = addressFrom(emptyAddress(), formatAddress(AUSTIN));
check('composing and re-reading keeps the street', round.line1 === AUSTIN.line1, round);
check('keeps the apartment', round.line2 === AUSTIN.line2, round);
check('keeps the city', round.city === AUSTIN.city, round);
check('keeps the state', round.state === AUSTIN.state, round);
check('keeps the ZIP', round.postalCode === AUSTIN.postalCode, round);

console.log(`\naddress: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
