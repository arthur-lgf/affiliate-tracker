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
r = await fetch('http://127.0.0.1:3018/links/new', { headers: { cookie: header() } });
const html = (await r.text()).split('<!-- -->').join('');
const at = html.indexOf('Who it belongs to');
const step = html.slice(at, at + 2600);
console.log(step.replace(/></g, '>\n<').split('\n').filter((l) => /select|option|field-label|field-note|plain|Assign/.test(l)).join('\n').slice(0, 2200));
