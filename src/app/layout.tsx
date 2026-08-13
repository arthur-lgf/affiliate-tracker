import type { Metadata } from 'next';
import { Public_Sans, Source_Serif_4 } from 'next/font/google';
import './globals.css';

/* Figures and headings. A serif at 60-80px is what makes a number read as an
   amount of money rather than as a label. */
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
});

/* Everything else. Public Sans has open apertures and unambiguous 1/l/I,
   which is the whole reason it is here rather than a geometric sans. */
const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
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
    <html lang="en" className={`${sourceSerif.variable} ${publicSans.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
