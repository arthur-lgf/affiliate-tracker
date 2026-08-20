import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getStore, storageStatus } from '../src/lib/store';

(async () => {
  console.log('store:', JSON.stringify(storageStatus()));
  const store = getStore();
  const [conversions, submissions] = await Promise.all([
    store.listConversions(),
    store.listSubmissions(),
  ]);
  console.log('conversions:', conversions.length);
  for (const c of conversions)
    console.log('  ', JSON.stringify({ slug: c.slug, usr: c.usr, amount: c.amount, notes: c.notes }));
  const counts: Record<string, number> = {};
  for (const s of submissions) counts[s.status] = (counts[s.status] ?? 0) + 1;
  console.log('submissions:', submissions.length, JSON.stringify(counts));
  for (const s of submissions) console.log('  ', s.id, s.status.padEnd(10), s.fullName);
})();
