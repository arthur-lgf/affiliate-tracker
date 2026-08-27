import { renderAgreementPdf } from '../src/lib/pdf/agreement-pdf';
import { pdfContent } from './read-pdf';
import type { AgreementRecord } from '../src/lib/onboarding-store';

const record: AgreementRecord = {
  affiliateName: 'Arthur Reyes',
  affiliateEmail: 'a@example.com',
  affiliateAddress: '1 Example Street',
  effectiveDate: '2026-08-24',
  signaturePng: '',
  affirmed: true,
  signedAt: '2026-08-24T18:42:58.327Z',
  signedIp: '203.0.113.9',
  signedUserAgent: 'Mozilla/5.0',
  agreementVersion: '2026-08',
} as AgreementRecord;

async function main() {
  const text = await pdfContent(await renderAgreementPdf(record));
  const at = text.indexOf('thirty');
  console.log('has thirty:', at);
  console.log(JSON.stringify(text.slice(0, 500)));
  if (at > 0) console.log(JSON.stringify(text.slice(at - 300, at + 200)));
}
void main();
