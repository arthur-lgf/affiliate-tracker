# Affiliate Ledger

Create affiliate links assigned to a person, capture the client's details on a short
landing page, log every one to Google Sheets, and forward the client to the merchant.

```
https://www.cardratings.com/bestcards/cash-back-credit-cards.php?src=714025   ← destination
http://localhost:3000/cashback?usr=arthur                                     ← your affiliate link
```

## What's in it

| Page | Path | What it does |
| --- | --- | --- |
| Dashboard | `/` | Totals, 14-day chart, leaderboards by assignee and campaign, recent submissions |
| Affiliate links | `/links` | Every link with its shareable URL, assignee, visits, leads, conversion; pause / delete |
| Create link | `/links/new` | Build a link: destination + slug + assignee, with a live URL preview |
| Landing page | `/<slug>?usr=<person>` | The client's fill-up form, then a redirect to the destination |

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

It works immediately with no configuration — data goes to `./.data/*.json`. Wire up
Google Sheets when you're ready; the app switches over automatically.

## Connect Google Sheets

1. **Create a spreadsheet.** A blank one is fine — the tabs and headers are created
   for you on first write.
2. **Google Cloud Console** → create (or pick) a project → **APIs & Services** →
   **Enable APIs** → enable **Google Sheets API**.
3. **IAM & Admin → Service Accounts** → *Create service account* → then
   **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
4. **Share the spreadsheet** with the `client_email` from that JSON file, as an
   **Editor**. This step is the one people forget — without it you get a 403.
5. Copy `.env.example` to `.env.local` and set the spreadsheet id:

```bash
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
```

That id is the long string between `/d/` and `/edit` in the sheet URL — **not** the
number after `#gid=`, which identifies a tab.

6. Give it the credentials, either way you prefer:

**A — the JSON key file** (simplest locally). Drop the file Google gave you into the
project root as `service-account.json`. Nothing else to configure; it's gitignored.
Keeping it elsewhere, or reusing one you already have, works too:

```bash
GOOGLE_SERVICE_ACCOUNT_FILE=../lgf-automation/service-account.json
```

`GOOGLE_APPLICATION_CREDENTIALS` (Google's own convention) is honoured as well.

**B — environment variables**, for hosts with no filesystem to put a key on, such as
Vercel. Copy the two fields out of the same JSON file:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-bot@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```

Keep the quotes and the literal `\n` sequences exactly as they appear in the JSON key.
If both are set, the environment variables win — a deployed environment is never
silently overridden by a stray file.

7. Restart the dev server. The header will read **Google Sheets connected**.

> Don't commit the key file, and don't put real values in `.env.example` — that file
> is the template that gets committed. Real values belong in `.env.local`.

### Sheet layout

Three tabs, created automatically:

- **Links** — `id, created_at, slug, usr, assignee, assignee_email, campaign, destination, headline, subheadline, cta_label, require_phone, pass_usr_param, active, notes`
- **Submissions** — `id, created_at, slug, usr, assignee, campaign, full_name, email, phone, destination, referrer, user_agent, ip`
- **Visits** — `id, created_at, slug, usr, referrer, user_agent, ip`

You can read, filter and pivot these rows in Sheets freely. Don't reorder or rename the
header columns — the app maps by position.

## How a link works

Creating a link stores a `slug` (the path) and a `usr` (the assignee's tracking key):

- `/cashback?usr=arthur` → the row created for **cashback + arthur**
- `/cashback?usr=bianca` → the row created for **cashback + bianca**
- `/cashback` → the campaign's house row (the one created with no assignee)
- `/cashback?usr=someone-unknown` → still lands, still logged, attributed to no one
  rather than dropped

**Pause is per assignee.** Pausing Arthur's link shows the "offer is paused" page to
Arthur's traffic; it does not quietly hand those visitors Bianca's link. The campaign
only reads as fully paused when every row for the slug is paused.

**Deleting a link does not stop its URL.** If another assignee still has a live row for
that slug, the URL keeps working and falls back to them. To take a URL down, pause it.

**Pass usr to destination as** (optional, per link): set it to e.g. `subid` and the
client is forwarded to `...?src=714025&subid=arthur`. Leave it blank — the default —
and the destination is forwarded exactly as you entered it.

## Before you deploy

- **Set `ADMIN_PASSWORD`.** The dashboard lists lead names, emails and phone numbers.
  With it set, `/`, `/links*` and `/api/links*` require HTTP Basic auth; landing pages
  and submissions stay public. A production build with no password returns 503 on the
  admin pages rather than exposing them — set `ALLOW_OPEN_ADMIN=true` to override that
  deliberately. Development is always open so `npm run dev` needs no configuration.
- **Set `NEXT_PUBLIC_BASE_URL`** to your public origin (e.g. `https://go.yourdomain.com`)
  so the copyable links aren't `localhost`.
- Landing pages are marked `noindex` — they're interstitials, not content.

## Notes and limits

- **Rate limiting** on submissions is per-instance and in-memory (12 per IP / 10 min;
  a looser per-campaign cap when no proxy header reveals the IP). On multiple
  instances, move it to Redis. The IP is a throttling hint, never identity — behind no
  proxy, `x-forwarded-for` is client-controlled.
- **Link creation** checks for a duplicate slug+usr by reading before writing. Two
  people creating the identical link in the same second could both succeed. Edits and
  deletes re-check the target row's id immediately before writing, so a concurrent
  change aborts rather than overwriting a different link.
- **An unrecognised `?usr=`** is logged as-is so you can spot stale or mistyped links
  on the dashboard, but it is never appended to the merchant URL — only a key that
  exists in your Links tab is passed on.
- **A lead is never written twice by a retry**: the one retry on the submission write
  only fires for failures that provably never reached Google.
- **Visit tracking** is a `sendBeacon` from the landing page, so ad blockers and
  clients that bail before the beacon fires will undercount. Conversion rate is
  directional, not exact. Set `TRACK_VISITS=false` to turn it off.
- **Timestamps** are stored in UTC (ISO-8601); the dashboard buckets days in UTC.
- If a lead's row fails to write, the client sees a retry message rather than being
  forwarded — losing a lead silently is worse than a second attempt.

## Scripts

```bash
npm run dev         # dev server
npm run build       # production build
npm start           # serve the production build
npm run typecheck   # tsc --noEmit
```
