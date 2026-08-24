/**
 * Sending one email, over HTTPS, with no dependency.
 *
 * Resend's send endpoint is a single JSON POST, so there is nothing an SDK
 * would do here that fetch does not — and a mail library is a large amount of
 * surface area to add for one message. Swapping provider is this file: the rest
 * of the app only knows sendEmail().
 *
 * Nothing here throws its way into a user-visible failure by accident. An
 * approval that could not be emailed is still an approval, so callers are
 * expected to catch EmailError and carry on; what they must not do is roll back
 * a decision because a mail server was slow.
 */

export class EmailError extends Error {
  /** True when the message was never attempted because nothing is configured,
   *  as opposed to attempted and refused. The two need different advice. */
  readonly unconfigured: boolean;

  constructor(message: string, options: { unconfigured?: boolean } = {}) {
    super(message);
    this.name = 'EmailError';
    this.unconfigured = options.unconfigured === true;
  }
}

const SEND_URL = 'https://api.resend.com/emails';

/** Resend will not accept a send that takes longer than this anyway, and a
 *  route holding a request open on a hung socket is worse than a failed send. */
const TIMEOUT_MS = 10_000;

function apiKey(): string {
  return (process.env.RESEND_API_KEY ?? '').trim();
}

/** `Ledger <noreply@example.com>` or a bare address. Must be a domain verified
 *  with the provider, or every send is refused. */
function from(): string {
  return (process.env.EMAIL_FROM ?? '').trim();
}

function replyTo(): string {
  return (process.env.EMAIL_REPLY_TO ?? '').trim();
}

export function emailConfigured(): boolean {
  return apiKey().length > 0 && from().length > 0;
}

/**
 * Why email is not working, in a sentence an admin can act on.
 *
 * Returned rather than thrown, and shown next to the thing that did work, so
 * "approved, but they were not told" is visible at the moment it happens
 * instead of being discovered a week later when somebody asks why they never
 * heard anything.
 */
export function emailProblem(): string {
  if (!apiKey()) return 'RESEND_API_KEY is not set, so no email was sent.';
  if (!from()) return 'EMAIL_FROM is not set, so no email was sent.';
  return '';
}

export type Message = {
  to: string;
  subject: string;
  /** Always required. Plenty of people read mail as text, and a message with no
   *  text part is a message some of them receive blank. */
  text: string;
  html?: string;
};

/**
 * Send it, or throw an EmailError saying why not.
 *
 * Returns the provider's id for the message, which is what makes "we sent it"
 * checkable against their dashboard rather than a claim.
 */
export async function sendEmail(message: Message): Promise<{ id: string }> {
  const problem = emailProblem();
  if (problem) throw new EmailError(problem, { unconfigured: true });

  const to = message.to.trim();
  if (!to) throw new EmailError('That account has no email address on file.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: from(),
        to: [to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(replyTo() ? { reply_to: replyTo() } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new EmailError(
      aborted ? 'The mail provider did not answer in time.' : 'Could not reach the mail provider.',
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json().catch(() => null)) as
    | { id?: string; message?: string; name?: string }
    | null;

  if (!response.ok) {
    // Their message, when there is one: "domain is not verified" is worth
    // passing through verbatim, and it is not something to paraphrase.
    const detail = body?.message || body?.name || `HTTP ${response.status}`;
    throw new EmailError(`The mail provider refused it: ${detail}`);
  }

  return { id: String(body?.id ?? '') };
}
