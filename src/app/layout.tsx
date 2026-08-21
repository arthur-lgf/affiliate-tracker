import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

/* Everything that is words. IBM Plex Sans has open apertures and an
   unambiguous 1/l/I, which matters on a page where a tracking key is read
   character by character. */
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

/* Everything that is a number: money, counts, keys, URLs. A monospace figure
   is what lets a column of amounts be compared down its right edge rather than
   read one by one, and it is why every numeric cell in the app carries .tnum. */
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Ledger',
    template: '%s · Ledger',
  },
  description: 'Create assigned affiliate links, capture leads, log every one to Google Sheets.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
