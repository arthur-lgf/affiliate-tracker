// Scratch helper, safe to delete. Prints the derived row id for each locally
// stored conversion — handy when checking a delete by hand.
//
//   npx tsx scripts/_tmp-ids.ts
import { readFileSync } from 'node:fs';
import { conversionToCells } from '../src/lib/store/conversion-row';
import { makeRowId } from '../src/lib/store/row-id';

const rows = JSON.parse(readFileSync('.data/conversions.json', 'utf8'));
rows.forEach((row: Record<string, never>, index: number) =>
  console.log(`${makeRowId(index, conversionToCells(row as never))} ${row.slug}/${row.usr}`),
);
