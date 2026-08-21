// Throwaway. Reads only — no writes anywhere.
//
// Proves the money boundary on the real data: the same rows, loaded once as an
// admin and once as the affiliate they belong to, and what the amount says in
// each case.
//
//   npx tsx scripts/_tmp-peek.ts
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { loadAll } from '../src/lib/load';
import { buildEarnings } from '../src/lib/analytics';
import type { Viewer } from '../src/lib/viewer-core';

const admin: Viewer = {
  id: 'probe-admin',
  username: 'probe',
  role: 'admin',
  usr: '',
  isEnvAdmin: true,
  open: false,
};

const affiliate = (usr: string): Viewer => ({
  id: 'probe-affiliate',
  username: 'probe',
  role: 'affiliate',
  usr,
  isEnvAdmin: false,
  open: false,
});

(async () => {
  const asAdmin = await loadAll(admin);
  console.log('admin  gross=' + asAdmin.gross, 'conversions=' + asAdmin.conversions.length);
  for (const row of asAdmin.conversions) console.log('   ', row.usr, row.amount);

  for (const usr of ['c89buy', 'he4nue']) {
    const theirs = await loadAll(affiliate(usr));
    console.log(`\n${usr}  gross=${theirs.gross}`, 'conversions=' + theirs.conversions.length);
    for (const row of theirs.conversions) console.log('   ', row.usr, row.amount);

    const view = buildEarnings(theirs.links, theirs.visits, theirs.conversions, { period: 'all' });
    console.log('    what their dashboard hero would print:', view.totals.earnings);
    const mine = asAdmin.conversions.filter((row) => row.usr === usr);
    console.log('    what an admin sees for them:', mine.reduce((s, r) => s + r.amount, 0));
  }
})();
