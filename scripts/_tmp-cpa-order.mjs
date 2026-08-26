import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const c = new Map();
const header = () => [...c].map(([k, v]) => k + '=' + v).join('; ');
const take = (r) => { for (const raw of r.headers.getSetCookie?.() ?? []) { const [p] = raw.split(';'); const i = p.indexOf('='); c.set(p.slice(0, i), p.slice(i + 1)); } };
let r = await fetch('http://127.0.0.1:3018/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: env.ADMIN_USER, password: env.ADMIN_PASSWORD }) });
take(r);
r = await fetch('http://127.0.0.1:3018/cpa', { headers: { cookie: header() } });
const html = (await r.text()).split('<!-- -->').join('');

const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
const rows = body.split('<tr').slice(1);
const text = (s) => s.replace(/<[^>]+>/g, '|').split('|').map((t) => t.trim()).filter(Boolean);
console.log('rows on page one:', rows.length);
const cards = [];
for (const row of rows) {
  const cells = text(row);
  const money = cells.filter((t) => /^\$[\d,]+/.test(t)).map((t) => Number(t.slice(1).replace(/,/g, '')));
  if (money.length === 0) continue;
  // A tier row is indented under its card and rises within it; only the card
  // rows are what the sort puts in order.
  if (cells.includes('↳')) continue;
  cards.push({ name: cells.slice(0, 3).join(' / ').slice(0, 52), pays: money[0] });
}
for (const c2 of cards) console.log('  $' + String(c2.pays).padStart(4), c2.name);
const tops = cards.map((c2) => c2.pays);
console.log('non-increasing down the page:', tops.every((v, i, a) => i === 0 || a[i - 1] >= v));
console.log('descending arrow present:', html.includes('aria-sort="descending"'));
console.log('pager:', (html.match(/Showing [^<]+/) || ['none'])[0]);
console.log('card rows found:', cards.length, 'of', rows.length, 'rows');
