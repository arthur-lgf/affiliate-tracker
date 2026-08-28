/**
 * A United States postal address, as a form has to ask for it.
 *
 * The agreement used to take the address as one free-text box, which is fine
 * until somebody types a state as "Tex." or leaves the ZIP off, and the copy
 * they sign carries it. Asking for the parts separately is what makes a state
 * a choice from a list rather than a spelling, and it is also what lets the W-9
 * fill its own line 5 and line 6 correctly instead of guessing where one ends
 * and the other begins.
 *
 * The signed agreement still stores one line of text, because that is what the
 * document prints and what the already-signed copies contain. The parts are
 * stored beside it, and the line is composed from them.
 */

export type Address = {
  line1: string;
  /** Apartment, suite, unit. Usually empty, and never required. */
  line2: string;
  city: string;
  /** A two-letter code from US_STATES, not a name. */
  state: string;
  postalCode: string;
};

/**
 * The states, then the District, then the territories.
 *
 * The territories are on the list because an affiliate in San Juan or Saipan is
 * a United States taxpayer filing a W-9, and a form that cannot spell where
 * they live is a form they cannot finish.
 */
export const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'GU', name: 'Guam' },
  { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
];

const BY_CODE = new Map(US_STATES.map((state) => [state.code, state.name]));

/** Five digits, or five and four. The only two shapes the USPS writes. */
export const ZIP = /^[0-9]{5}(-[0-9]{4})?$/;

export function emptyAddress(): Address {
  return { line1: '', line2: '', city: '', state: '', postalCode: '' };
}

export function isStateCode(code: string): boolean {
  return BY_CODE.has((code ?? '').trim().toUpperCase());
}

export function stateName(code: string): string {
  return BY_CODE.get((code ?? '').trim().toUpperCase()) ?? '';
}

/**
 * Trimmed, with the state upper-cased, ready to be stored or compared.
 *
 * Runs of whitespace collapse to a single space, which is what keeps the
 * composed line a single line. The form cannot produce a newline, since these
 * are inputs rather than a text box, but the endpoint behind it takes whatever
 * it is sent, and what it is sent ends up drawn on a contract.
 */
export function tidyAddress(address: Partial<Address> | null | undefined): Address {
  const flat = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  return {
    line1: flat(address?.line1),
    line2: flat(address?.line2),
    city: flat(address?.city),
    state: flat(address?.state).toUpperCase(),
    postalCode: flat(address?.postalCode),
  };
}

/** "Austin, TX 78701". The second line of every US form ever printed. */
export function cityStateZip(address: Partial<Address>): string {
  const tidy = tidyAddress(address);
  const tail = [tidy.state, tidy.postalCode].filter(Boolean).join(' ');
  if (!tidy.city) return tail;
  return tail ? `${tidy.city}, ${tail}` : tidy.city;
}

/**
 * The one line that goes into the signed agreement.
 *
 * One line and not several: the document draws this as a field beside its
 * label, and a line break there would come out as a stray glyph or as the lost
 * half of somebody's address.
 */
export function formatAddress(address: Partial<Address>): string {
  const tidy = tidyAddress(address);
  return [tidy.line1, tidy.line2, cityStateZip(tidy)].filter(Boolean).join(', ');
}

/** True once there is anything worth storing. */
export function hasAddress(address: Partial<Address>): boolean {
  return formatAddress(address) !== '';
}

/**
 * What is missing, keyed the way the form names its fields.
 *
 * Line 2 is never required, because most addresses do not have one. The ZIP is
 * checked for shape rather than for existence in the postal file: a typo in the
 * last digit is not something this could catch, and pretending otherwise would
 * mean rejecting the real address of anybody in a new development.
 */
export function addressProblems(address: Partial<Address>): Record<string, string> {
  const tidy = tidyAddress(address);
  const problems: Record<string, string> = {};
  if (!tidy.line1) problems.addressLine1 = 'Street address.';
  if (!tidy.city) problems.addressCity = 'City.';
  if (!tidy.state) problems.addressState = 'Pick a state.';
  else if (!isStateCode(tidy.state)) problems.addressState = 'Pick a state from the list.';
  if (!tidy.postalCode) problems.addressPostalCode = 'ZIP code.';
  else if (!ZIP.test(tidy.postalCode)) problems.addressPostalCode = 'Five digits, or ZIP+4.';
  return problems;
}

/**
 * An old free-text address, split into the parts as best it can be.
 *
 * For filling a form in, never for what gets signed. Agreements were signed
 * before this page had separate fields, and somebody coming back to re-sign one
 * should find their address where they left it rather than an empty form.
 *
 * The rule it keeps whatever happens: nothing is dropped. If the tail does not
 * look like a city, a state and a ZIP, the whole string stays in line 1 for the
 * person to move themselves. A parser that quietly loses half an address is
 * worse than one that gives up.
 */
export function parseAddress(text: string): Address {
  const chunks = (text ?? '')
    .split(/[\n,]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (chunks.length === 0) return emptyAddress();

  const address = emptyAddress();
  /*
   * Chunks come off the end only once they have been understood. A tail that
   * looks like nothing in particular stays in the list and ends up in the
   * street lines, which is the whole promise: unparseable is not the same as
   * discarded.
   */
  const rest = chunks.slice();
  const tail = rest[rest.length - 1]!;

  // "Austin TX 78701", or the same with the city already split off by a comma.
  const together = tail.match(/^(.*?)[\s,]*\b([A-Za-z]{2})\s+([0-9]{5}(?:-[0-9]{4})?)$/);
  const zipOnly = tail.match(/^([0-9]{5}(?:-[0-9]{4})?)$/);

  if (together && isStateCode(together[2]!)) {
    rest.pop();
    address.state = together[2]!.toUpperCase();
    address.postalCode = together[3]!;
    const city = (together[1] ?? '').trim();
    if (city) address.city = city;
    else if (rest.length > 1) address.city = rest.pop()!;
  } else if (zipOnly && rest.length > 1) {
    rest.pop();
    address.postalCode = zipOnly[1]!;
    if (isStateCode(rest[rest.length - 1]!)) {
      address.state = rest.pop()!.toUpperCase();
      if (rest.length > 1) address.city = rest.pop()!;
    } else if (rest.length > 1) {
      address.city = rest.pop()!;
    }
  }

  if (rest.length > 0) {
    address.line1 = rest[0]!;
    address.line2 = rest.slice(1).join(', ');
  }

  return address;
}

/**
 * The parts of a stored agreement, falling back to reading the old one line.
 *
 * A row signed before the fields existed has empty parts and a full line, so
 * the form reads the line. A row signed since has the parts, and the line is
 * only what the document prints.
 */
export function addressFrom(parts: Partial<Address> | null | undefined, line: string): Address {
  const tidy = tidyAddress(parts);
  return hasAddress(tidy) ? tidy : parseAddress(line);
}
