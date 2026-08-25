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
r = await fetch('http://127.0.0.1:3018/api/users', { method: 'POST', headers: { 'content-type': 'application/json', cookie: header() }, body: JSON.stringify({ username: 'zz-shot', fullName: 'Franco Test', role: 'affiliate' }) });
const made = await r.json();
await fetch('http://127.0.0.1:3018/api/users/' + made.user.id + '/bypass', { method: 'POST', headers: { 'content-type': 'application/json', cookie: header() }, body: JSON.stringify({ on: true, note: 'screenshot' }) });
console.log('ID=' + made.user.id);
console.log('PASS=' + made.password);
