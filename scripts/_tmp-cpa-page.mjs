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
const has = (s) => html.includes(s);
console.log('status:', r.status);
console.log('a kept flat card (Business Gold):', has('American Express(R) Business Gold Card'));
console.log('a kept tiered card (Blue Cash Preferred):', has('Blue Cash Preferred'));
console.log('a dropped card (Chase Slate):', has('Chase Slate'));
console.log('a dropped card (Bilt Blue):', has('Bilt Blue'));
console.log('a dropped card (Greenlight):', has('Greenlight'));
const counts = [...html.matchAll(/(\d+)\s+cards?/gi)].map((m) => m[0]).slice(0, 4);
console.log('count phrases on the page:', counts.join(' | ') || 'none');
