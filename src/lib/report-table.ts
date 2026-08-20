/**
 * Reading a QMP report as a table: what each column is, how a cell should look,
 * and what order the rows go in.
 *
 * QMP hands back strings and numbers with no type information, and its column
 * names carry the only clue about what they mean — "Total Earnings($)" is
 * money, "Click to App Rate(%)" is a percentage, "Impressions" is a count. Its
 * own UI puts the symbols back on the values; this does the same, so a figure
 * read here means what it means there.
 *
 * Kept out of the component because all of it is decisions about data rather
 * than about pixels, and because a money column formatted wrong is a number
 * somebody acts on. scripts/report-table-checks.ts holds it to that.
 */

/** What a cell says when there is nothing in it. */
export const BLANK = '-';

export type ColumnKind = 'currency' | 'percent' | 'number' | 'text';

export type SortDirection = 'asc' | 'desc';

/*
 * The names are matched first on QMP's own suffixes, which are explicit and
 * always right, then on words, which are a fallback for a report whose columns
 * were renamed in the builder. `\(\$\)` before the word list matters: a column
 * called "Earnings Rate($)" is money, not a percentage.
 */
const CURRENCY_SUFFIX = /\(\s*\$\s*\)/;
const PERCENT_SUFFIX = /\(\s*%\s*\)/;
const CURRENCY_WORD = /\b(earnings?|revenue|payout|epc|cpc|cpa|cost|amount|spend)\b/i;
const PERCENT_WORD = /\b(rate|ctr|percent|percentage)\b/i;

/**
 * A number, or null if the value is not one.
 *
 * Deliberately stricter than parseNumber in lib/qmp-sync, which exists to get a
 * figure out of a measure column and so strips whatever is not a digit. That is
 * right there and wrong here: this decides what a whole column *is*, and under
 * those rules the tracking key "yre648" reads as the number 648. A column of
 * keys would then be a numeric column, sorted by an invented value, with a
 * dollar sign put on it if it were called the wrong thing.
 *
 * So the whole value has to look like a number: an optional sign, an optional
 * dollar in front, an optional percent behind, digits with thousands
 * separators, and nothing else. Accountant's parentheses count as a minus,
 * because that is how a spreadsheet writes one.
 */
export function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  let text = value.trim();
  if (text === '') return null;

  let negative = false;
  const parens = /^\((.*)\)$/.exec(text);
  if (parens) {
    negative = true;
    text = parens[1]!.trim();
  }

  // A loop, because the sign and the symbol arrive in either order: QMP sends
  // -$412.50 and a hand-edited sheet sends $-412.50.
  for (let changed = true; changed; ) {
    changed = false;
    if (text.startsWith('-')) {
      negative = !negative;
      text = text.slice(1).trim();
      changed = true;
    } else if (text.startsWith('+') || text.startsWith('$')) {
      text = text.slice(1).trim();
      changed = true;
    }
  }
  if (text.endsWith('%')) text = text.slice(0, -1).trim();

  const digits = text.replace(/,/g, '');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(digits)) return null;

  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/** Nothing to show: null, absent, empty, or a placeholder QMP put there. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  const text = String(value).trim();
  if (text === '' || text === '-' || text === '—') return true;
  const lowered = text.toLowerCase();
  return lowered === 'null' || lowered === 'n/a' || lowered === 'na';
}

/**
 * What kind of column this is, from its name and everything in it.
 *
 * The values get a vote because the name alone is not enough: a column of
 * dates, tracking keys or state codes must never be treated as numeric, and
 * "Var2" says nothing either way. A column counts as numeric only if every
 * value in it that is not blank parses as a number — one "JavaScript
 * Transition" in a thousand rows and the whole column is text, which is the
 * safe way round. Sorting text as numbers silently reorders it.
 */
export function columnKind(name: string, values: unknown[]): ColumnKind {
  const present = values.filter((value) => !isBlank(value));
  const numeric = present.length > 0 && present.every((value) => numericValue(value) !== null);
  if (!numeric) return 'text';

  if (PERCENT_SUFFIX.test(name)) return 'percent';
  if (CURRENCY_SUFFIX.test(name)) return 'currency';
  if (PERCENT_WORD.test(name)) return 'percent';
  if (CURRENCY_WORD.test(name)) return 'currency';
  return 'number';
}

function withDecimals(value: number, min: number, max: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
}

/** How a cell reads on screen. Always a string, never empty. */
export function formatCell(value: unknown, kind: ColumnKind): string {
  if (isBlank(value)) return BLANK;

  if (kind === 'text') {
    return typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
  }

  const parsed = numericValue(value);
  // Numeric by column, but not this cell. Show what QMP sent rather than a
  // dash: a value that will not parse is worth seeing, not hiding.
  if (parsed === null) return String(value).trim();

  if (kind === 'currency') {
    // The sign goes in front of the symbol. "$-412.50" is a typo; "-$412.50"
    // is a clawback.
    const sign = parsed < 0 ? '-' : '';
    return `${sign}$${withDecimals(Math.abs(parsed), 2, 2)}`;
  }
  if (kind === 'percent') return `${withDecimals(parsed, 2, 2)}%`;
  // Counts keep their thousands separator and lose nothing: 2,345 and 1,234.5
  // both read as themselves.
  return withDecimals(parsed, 0, 2);
}

/** Numbers and percentages read down a right edge; words read down a left one. */
export function alignsRight(kind: ColumnKind): boolean {
  return kind !== 'text';
}

/**
 * Rows in sorted order, with the empty ones always at the end.
 *
 * Blanks last in both directions, deliberately. A report is mostly holes — see
 * any screenshot of one — and sorting by Approvals to find the rows that have
 * some, only to be given a screen of dashes, is the wrong answer to the
 * question that was asked. Reversing the direction reverses the rows that have
 * a value; it never promotes the ones that do not.
 */
export function sortRows<T>(
  rows: T[],
  read: (row: T) => unknown,
  kind: ColumnKind,
  direction: SortDirection,
): T[] {
  const present: T[] = [];
  const blank: T[] = [];
  for (const row of rows) (isBlank(read(row)) ? blank : present).push(row);

  const factor = direction === 'asc' ? 1 : -1;
  // Negated rather than reversed: reversing a sorted array also reverses the
  // ties, so rows that compare equal would swap places every time the arrow is
  // clicked and the table would never look settled.
  const sorted = [...present].sort((a, b) => factor * compare(read(a), read(b), kind));
  return [...sorted, ...blank];
}

function compare(a: unknown, b: unknown, kind: ColumnKind): number {
  if (kind !== 'text') {
    const left = numericValue(a);
    const right = numericValue(b);
    if (left !== null && right !== null) return left - right;
    if (left !== null) return -1;
    if (right !== null) return 1;
  }
  // `numeric: true` so "Card 2" comes before "Card 10", and base sensitivity so
  // case does not split a name into two places in the list.
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/* Paging used to live here too. It moved to lib/paging once the links and the
   accounts wanted the same thing: where a page starts is not a decision about
   what a QMP column means, which is all this module is for. */
