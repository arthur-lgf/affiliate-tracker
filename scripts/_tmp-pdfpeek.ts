import { ratesForViewer } from '../src/lib/cpa';
import { groupRates, defaultSort, sortGroups, NO_FILTER } from '../src/lib/cpa-groups';
import { buildCpaPdf } from '../src/lib/pdf/cpa-pdf';
import type { CpaExportMeta } from '../src/lib/cpa-export';
import { pdfContent } from './read-pdf';

async function main() {
  const rows = ratesForViewer([{ placement: 'p', issuer: 'AmEx', card: 'Platinum Card', tier: '', current: 700, previous: 600, change: 0.1, changedOn: '2026-07-01' }], true);
  const meta: CpaExportMeta = { reportDate: '2026-07-01', exportedOn: '2026-08-26T10:00:00Z', exportedBy: 'evan', gross: true, filter: NO_FILTER, sort: defaultSort(true), total: 1 };
  const bytes = await buildCpaPdf(sortGroups(groupRates(rows), defaultSort(true), true), meta);
  const text = await pdfContent(bytes);
  console.log('length', text.length);
  console.log(JSON.stringify(text.slice(0, 700)));
}
void main();
