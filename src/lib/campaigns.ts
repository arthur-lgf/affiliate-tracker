/**
 * Campaign categories, kept out of lib/config.ts on purpose.
 *
 * config.ts reaches for the Google credentials helper, which imports node:fs
 * and node:path. LinkForm is a client component, so importing this list from
 * there would drag those into the browser bundle and fail the build with an
 * UnhandledSchemeError. A list of strings needs no server code, so it lives
 * alone.
 */
export const CAMPAIGNS = [
  '0% Intro APR',
  'Bad Credit',
  'Balance Transfer',
  'Best Cards',
  'CardFinder',
  'Cash Back',
  'Credit Builder',
  'Credit Card Deals',
  'Excellent Credit Needed',
  'Fair Credit',
  'Gas',
  'Good Credit Needed',
  'Hotel',
  'Limited Credit',
  'Low Ongoing Rate',
  'Miles',
  'No Annual Fee',
  'No Foreign Transaction Fee',
  'Premium',
  'Rewards',
  'Secured',
  'Small Business',
  'Student',
  'Travel Rewards',
] as const;
