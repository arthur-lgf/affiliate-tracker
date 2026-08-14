/**
 * The reference that ties a lead to what the merchant reports back.
 *
 * It is minted before the row is written, because it has to be inside the
 * destination URL the visitor is about to follow. That is the whole point: the
 * value lands in QMP's var3 column, so an approval weeks later can be traced to
 * the exact person who filled the form.
 *
 * Short on purpose. It travels as a query parameter through the merchant's own
 * redirects before anything records it, and a 36 character uuid is a lot of
 * string to hand to a pipeline nobody here controls. Twelve base36 characters
 * is about 4.7e18 possibilities, which is far more than enough to never
 * collide at any volume this tool will see, while staying short enough to read
 * off a spreadsheet and type into a search box.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 12;

export function newLeadId(): string {
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  // Rejection-free: 256 is not a multiple of 36, so the low values are very
  // slightly favoured. That bias is irrelevant for an identifier that only has
  // to be unique, and avoiding it would cost a retry loop for nothing.
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/**
 * Whether a string looks like one of ours. Used to tell a lead reference apart
 * from the uuids rows were given before this existed, and from whatever else
 * might end up in a var3 column.
 */
export function isLeadId(value: string): boolean {
  return new RegExp(`^[a-z0-9]{${LENGTH}}$`).test(value);
}
