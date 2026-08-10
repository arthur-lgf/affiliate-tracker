import { z } from 'zod';
import { RESERVED_SLUGS } from './config';

/** Lowercase, url-safe, no leading/trailing dashes. */
export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .min(2, 'Slug must be at least 2 characters')
  .max(48, 'Slug must be 48 characters or fewer')
  .transform(normalizeKey)
  .refine((v) => keyPattern.test(v), 'Use letters, numbers and dashes only')
  .refine((v) => !RESERVED_SLUGS.has(v), (v) => ({ message: `"${v}" is a reserved path` }));

export const usrSchema = z
  .string()
  .trim()
  .max(48, 'Assignee key must be 48 characters or fewer')
  .transform(normalizeKey)
  .refine((v) => v === '' || keyPattern.test(v), 'Use letters, numbers and dashes only');

/**
 * Destination must be an absolute http(s) URL. This is the only value we ever
 * redirect a visitor to, so anything that is not plainly http/https is rejected
 * here rather than at redirect time.
 */
export const destinationSchema = z
  .string()
  .trim()
  .min(1, 'Destination URL is required')
  .max(2000, 'Destination URL is too long')
  .superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a full URL including https://',
      });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only http:// and https:// destinations are allowed',
      });
    }
  });

export const linkInputSchema = z.object({
  slug: slugSchema,
  usr: usrSchema.optional().default(''),
  assignee: z.string().trim().max(120).optional().default(''),
  assigneeEmail: z
    .union([z.literal(''), z.string().trim().email('Enter a valid email')])
    .optional()
    .default(''),
  campaign: z.string().trim().min(1, 'Campaign name is required').max(120),
  destination: destinationSchema,
  headline: z.string().trim().max(160).optional().default(''),
  subheadline: z.string().trim().max(300).optional().default(''),
  ctaLabel: z.string().trim().max(60).optional().default(''),
  requirePhone: z.boolean().optional().default(false),
  passUsrParam: z
    .string()
    .trim()
    .max(32)
    .optional()
    .default('')
    .transform((v) => v.replace(/[^A-Za-z0-9_\-]/g, '')),
  active: z.boolean().optional().default(true),
  notes: z.string().trim().max(500).optional().default(''),
});

export type LinkInput = z.infer<typeof linkInputSchema>;

export const linkPatchSchema = linkInputSchema.partial();

export const submissionInputSchema = z.object({
  slug: slugSchema,
  usr: usrSchema.optional().default(''),
  fullName: z.string().trim().min(2, 'Please enter your name').max(120),
  email: z.string().trim().email('Enter a valid email address').max(160),
  phone: z.string().trim().max(40).optional().default(''),
  // Honeypot: real people never fill this in.
  company: z.string().max(200).optional().default(''),
});

export const visitInputSchema = z.object({
  slug: slugSchema,
  usr: usrSchema.optional().default(''),
});

/** Flatten a ZodError into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
