import { SHEET_HEADERS } from '../src/lib/config';
import { planHeaderRow } from '../src/lib/store/sheets';
const OLD = ['id','created_at','approved_on','slug','usr','assignee','card','amount','notes'];
console.log('old 9-col tab ->', JSON.stringify(planHeaderRow(OLD, SHEET_HEADERS.conversions)));
console.log('brand new tab ->', JSON.stringify(planHeaderRow([], SHEET_HEADERS.conversions)));
console.log('already new   ->', JSON.stringify(planHeaderRow([...SHEET_HEADERS.conversions], SHEET_HEADERS.conversions)));
