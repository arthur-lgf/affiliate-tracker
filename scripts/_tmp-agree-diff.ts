import { readFileSync } from 'node:fs';
import { allParagraphs, COMPANY, SUMMARY, SUMMARY_INTRO } from '../src/lib/agreement';

const source = readFileSync(
  'C:/Users/salva/AppData/Local/Temp/claude/c--Users-salva-Documents-LGF-Projects/9f840379-31e2-4061-98ec-c3302f338a70/scratchpad/agreement-source.txt',
  'utf8',
);

const app = [
  SUMMARY_INTRO,
  ...SUMMARY.map((row) => row.term + ' ' + row.details),
  ...allParagraphs().map((p) => (p.heading ?? '') + ' ' + p.text),
  COMPANY.name,
].join(' | ');

const norm = (s: string) =>
  s
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014\ufffd]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const haystack = norm(app);
const missing: string[] = [];
let checked = 0;
for (const raw of source.split('\n')) {
  const line = raw.trim();
  if (line.length < 25) continue;
  checked++;
  if (!haystack.includes(norm(line))) missing.push(line);
}
console.log('source lines checked:', checked);
console.log('missing from the app text:', missing.length);
for (const line of missing) console.log('  -', line.slice(0, 160));
console.log('app chars:', app.length, 'source chars:', source.length);
