# ReachInbox Email Job Scheduler

A full-stack email scheduler: an Express + BullMQ backend that schedules and sends emails through Ethereal SMTP, and a Next.js dashboard to compose, schedule and track them.

> Work in progress: see the Progress table at the end.

## Tech stack

| Layer    | Technology                                            |
| -------- | ----------------------------------------------------- |
| Backend  | TypeScript, Express.js                                |
| Queue    | BullMQ on Redis                                       |
| Database | MySQL 8                                               |
| Search   | Elasticsearch 8                                       |
| Email    | Ethereal Email (SMTP)                                 |
| Frontend | Next.js (App Router), React, Tailwind CSS, TypeScript |
| Infra    | Docker Compose for MySQL, Redis and Elasticsearch     |

## Repository layout

```
backend/    Express API (src/server.ts) and worker process (src/worker.ts)
frontend/   Next.js dashboard
docker-compose.yml
```

## Getting started

Requirements: Node.js 20+, Docker.

```bash
# 1. Install dependencies for both workspaces
npm install

# 2. Start MySQL, Redis and Elasticsearch
npm run infra:up

# 3. Configure environment variables
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
# then, in backend/.env:
#   ENCRYPTION_KEY        output of: openssl rand -hex 32
#   JWT_SECRET            output of: openssl rand -hex 32
#   GOOGLE_CLIENT_ID      see "Google sign-in setup" below
#   GOOGLE_CLIENT_SECRET
#   BULL_BOARD_PASSWORD   any password of 8+ characters, for the queue dashboard

# 4. Create the database tables
npm run db:migrate -w backend

# 5. Create the Ethereal sender accounts (see "Ethereal setup" below)
npm run seed:senders -w backend

# 6. Run each process in its own terminal
npm run dev:api      # API on http://localhost:4000
npm run dev:worker   # BullMQ worker process
npm run dev:web      # Dashboard on http://localhost:3000
```

Open http://localhost:3000 and sign in with Google. To check the services: `curl http://localhost:4000/health` (reports MySQL, Redis and Elasticsearch).

The frontend proxies `/api/*` and `/admin/queues` to the backend (see `frontend/next.config.ts`), so the browser only talks to one origin.

### Queue dashboard

Bull Board shows the email queue live (delayed, waiting, active, completed and failed jobs) at http://localhost:3000/admin/queues (or :4000). Sign in with `BULL_BOARD_USERNAME` / `BULL_BOARD_PASSWORD`; the dashboard is disabled while the password is empty.

### Infrastructure notes

- **Redis** runs with `appendonly yes` (AOF persistence), so delayed jobs survive a restart, and with `maxmemory-policy noeviction`, which BullMQ requires.
- **Elasticsearch** runs as a single node with security disabled and a 512 MB heap, for local development only.
- **MySQL** runs `docker/mysql/init.sql` when its volume is first created. It lets the app user create the temporary database `prisma migrate dev` needs.
- All data lives in named Docker volumes. `npm run infra:down` stops the containers and keeps the data.

## Google sign-in setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or pick one).
2. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name and your email. While the app is in _Testing_, add the Google accounts that may sign in under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**:
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URIs: `http://localhost:3000/api/auth/google/callback`
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`, and restart the API.

The redirect URI points at the frontend because the frontend proxies `/api/*` to the backend: the session cookie is then set for the site the browser is on. If you serve the app elsewhere, set `FRONTEND_URL` and add the matching redirect URI (or set `GOOGLE_CALLBACK_URL`).

**How sign-in works.** The backend runs Google's OAuth 2.0 authorization-code flow:

- A signed, 10-minute cookie carries a random `state` value (against forged sign-in callbacks) and a PKCE verifier.
- The code is exchanged server-side, and Google's ID token is verified (signature, audience, expiry). The email must be verified.
- The user is created, or updated with the latest name and photo, then gets a 7-day session: a signed JWT in an `httpOnly`, `SameSite=Lax` cookie.
- Page scripts can't read the cookie, and browsers don't send it on cross-site POSTs; together with JSON-only request bodies, that protects the API from CSRF.
- Logging out clears the cookie. Pages under the app check the session with the backend and send signed-out visitors to `/login`.

The login page shows the email and password fields from the design, disabled: only Google sign-in is supported.

## Ethereal setup

[Ethereal](https://ethereal.email) is a fake SMTP service: it accepts emails and shows them in a web inbox, but never delivers them. The app sends from several Ethereal accounts ("senders").

- **Automatic:** `npm run seed:senders -w backend` creates `SEED_SENDER_COUNT` accounts (default 3) through Nodemailer's API.
- **Manual:** create accounts at https://ethereal.email, then set `ETHEREAL_SENDERS="user1@ethereal.email:pass1,user2@ethereal.email:pass2"` in `backend/.env` and run the same command.

Add `-- --verify` to check each SMTP login. The script is safe to re-run. Passwords are stored encrypted (AES-256-GCM with `ENCRYPTION_KEY`).

## Database

MySQL is the source of truth. The schema lives in `backend/prisma/schema.prisma`, and migrations in `backend/prisma/migrations`.

| Table                | Purpose                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `users`              | Google accounts that have signed in                                                                     |
| `senders`            | SMTP accounts emails are sent from (encrypted passwords)                                                |
| `campaigns`          | One Compose submission: subject, body, start time, delay, hourly limit                                  |
| `emails`             | One row per recipient, with status `scheduled → sending → sent/failed` (or `delayed` when rate-limited) |
| `slack_integrations` | Per-user Slack webhook (encrypted) for rate-limit alerts                                                |

Key constraints: `emails(campaign_id, recipient)` is unique, so a lead can't be scheduled twice in one campaign, and `campaigns(user_id, idempotency_key)` is unique, so a double-clicked Schedule creates one campaign.

All times are stored in UTC.

## API

All `/api/*` routes except sign-in need the session cookie, and only ever return the signed-in user's data (401 without a valid session).

To call the API from curl or Postman: sign in at http://localhost:3000, copy the `rb_session` cookie (browser dev tools → Application → Cookies), and send it as a `Cookie` header.

| Method | Path                                                    | Purpose                                                                                                         |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/google`                                      | Start Google sign-in (optional `?returnTo=/sent`)                                                               |
| GET    | `/api/auth/google/callback`                             | Where Google sends the browser back                                                                             |
| GET    | `/api/auth/me`                                          | The signed-in user (name, email, avatar)                                                                        |
| POST   | `/api/auth/logout`                                      | Sign out (clears the session cookie)                                                                            |
| POST   | `/api/campaigns`                                        | Schedule one email per recipient. Send an `Idempotency-Key` header                                              |
| POST   | `/api/campaigns/preview`                                | Projected start/finish time for a campaign, without saving                                                      |
| GET    | `/api/emails?status=scheduled\|sent&page=1&pageSize=25` | Scheduled or Sent list, paginated. Optional `q` (recipient or subject) and `filter` (one status, e.g. `failed`) |
| GET    | `/api/emails/counts`                                    | Numbers for the sidebar                                                                                         |
| GET    | `/api/emails/:id`                                       | One email with its body and sender                                                                              |
| GET    | `/api/senders`                                          | Senders for the Compose "From" dropdown                                                                         |
| GET    | `/health`                                               | MySQL, Redis and Elasticsearch status                                                                           |

Example:

```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H 'content-type: application/json' \
  -H 'cookie: rb_session=<value from your browser>' \
  -H 'idempotency-key: compose-2f9c1a7e' \
  -d '{
    "senderId": 1,
    "subject": "Meeting follow-up",
    "bodyHtml": "<p>Hi, just following up.</p>",
    "recipients": ["a@example.com", "b@example.com"],
    "startAt": "2026-10-01T10:00:00Z",
    "delayMs": 5000,
    "hourlyLimit": 50
  }'
```

## Dashboard

The frontend follows the Figma (login, Scheduled and Sent lists, email view, Compose with Send Later), with some additions:

**Lists (Scheduled, Sent)**

- Search by recipient or subject, and filter by status (Scheduled / Delayed, or Sent / Failed). Search, filter and page are kept in the URL, so Back and shared links keep them.
- Refresh every 5 s while the tab is visible, plus a manual refresh button. The sidebar counts update the same way, with a red dot on Sent when something failed.
- Each row shows a status pill (the scheduled time, _Delayed_ when a sending limit moved it, _Sending_, _Sent_ or _Failed_) and a relative time ("in 5 minutes", "2 hours ago"), with the exact time on hover.
- Skeleton loading, empty states with a next step, error states with retry, and pagination.

**Email view**

- The email as sent. Its HTML is shown in a sandboxed frame, so it can't run scripts or restyle the app.
- A delivery timeline:
  - when the email was scheduled,
  - when it was sent, or why it failed and after how many attempts,
  - whether it's waiting for the next window,
  - the Ethereal preview link and Message-ID.

**Compose**

- Recipients:
  - Type, paste (any text: all addresses are picked out) or **Upload List** (CSV or TXT, addresses found in any column).
  - Recipients show as chips (the first 3, then "+N").
  - The upload summary shows how many addresses were detected, how many duplicates were skipped and how many invalid entries were ignored.
- **From** lists the senders with this hour's usage. Delay and hourly limit show the limits that will actually apply.
- A rich-text editor with the Figma toolbar: undo/redo, text size, bold/italic/underline, alignment, lists, indent, quote, strikethrough.
- **Send Later** offers presets (Now, In 1 hour, Tomorrow 9 AM / 11 AM / 3 PM, Monday 9 AM) or any date and time. It shows a live estimate of when the last email will go out, based on the delay, the limits and the number of recipients.
- Other details:
  - Fields are checked before sending.
  - `Ctrl`/`Cmd` + `Enter` schedules.
  - Leaving with unsaved changes asks first.
  - A double-clicked or retried Schedule can't create two campaigns (`Idempotency-Key`).

**Everywhere**

- Keyboard: `c` opens Compose, `/` jumps to search.
- Toast messages for success and errors.
- If the session expires, the next request sends you to sign in and back to the same page.
- Works down to phone width.

## How scheduling works

1. **Validate and clean.** Recipients are trimmed, lowercased and de-duplicated. Any invalid address rejects the request with the list of bad ones.
2. **Plan send times.** `schedulePlanner.ts` spaces emails `delayMs` apart from `startAt`. When a rate-limit window (an hour by default) already holds `hourlyLimit` of this campaign's emails, the next one moves to the start of the next window, so order is kept and nothing is dropped. This gives accurate times in the Scheduled list and the Compose preview; the worker still enforces every limit at send time (see [Rate limiting](#rate-limiting-and-concurrency)). The settings applied can only be stricter than requested:
   - start time: a past `startAt` becomes now
   - delay: at least `MIN_SEND_INTERVAL_MS`
   - hourly limit: at most the sender's cap (`MAX_EMAILS_PER_HOUR_PER_SENDER`)
3. **Save.** The campaign and one `emails` row per recipient are written in a single MySQL transaction. MySQL is the source of truth.
4. **Queue.** Each row gets a BullMQ delayed job with `jobId = email-<id>` and `delay = scheduledAt - now`, added in batches of 500. Because job IDs are deterministic, adding the same email again does nothing.

**Idempotency.** Repeating a request with the same `Idempotency-Key` returns the original campaign (HTTP 200) instead of creating a new one, even when several arrive at once. If Redis is down, the campaign is still saved and the API answers 503; retrying with the same key queues the jobs once Redis is back.

## How sending works

The worker (`npm run dev:worker`) is a separate process that runs `WORKER_CONCURRENCY` jobs in parallel. For each due job:

1. **Rate limit.** Ask the limiter for a send slot. If the sender or campaign is at its limit, the email moves to a later window (see below).
2. **Claim.** One conditional `UPDATE` moves the row from `scheduled`/`delayed` to `sending`. Only one worker can win it, however many copies of the job exist.
3. **Send** through the sender's pooled SMTP connection (one pool per sender), with a fixed `Message-ID` of `<email-<id>.c<campaign>@reachinbox.local>`.
4. **Record.** A delivery marker is written to Redis as soon as SMTP accepts the message, then the row becomes `sent` with the time, Message-ID and Ethereal preview link.

**Failures.** SMTP 4xx replies and network errors are temporary: the row goes back to `scheduled` and BullMQ retries (3 attempts, exponential backoff from 5 s). 5xx replies (bad mailbox, bad credentials) are permanent: the row becomes `failed` at once, with the error saved.

**No duplicates.** Several layers stop an email from being sent twice:

| Layer                             | Protects against                                                 |
| --------------------------------- | ---------------------------------------------------------------- |
| Deterministic job ID `email-<id>` | The same email being queued twice                                |
| Conditional claim in MySQL        | Two workers or two jobs processing the same email                |
| Unique `(campaign_id, recipient)` | A lead appearing twice in one campaign                           |
| Delivery marker in Redis          | Re-sending after a crash between the SMTP send and saving `sent` |
| `Idempotency-Key`                 | A double-submitted Schedule creating a second campaign           |

The one unavoidable gap: if a worker is killed after the SMTP server accepted a message but before it confirmed, the message may be sent again when recovered. No SMTP client can close that gap.

## Rate limiting and concurrency

| Setting                          | Default   | Meaning                                                                        |
| -------------------------------- | --------- | ------------------------------------------------------------------------------ |
| `WORKER_CONCURRENCY`             | 5         | Jobs each worker process runs in parallel                                      |
| `MIN_SEND_INTERVAL_MS`           | 2000      | Minimum gap between two sends from the same sender (**min 2 s between sends**) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | 200       | Emails per sender per window, across all campaigns and users                   |
| Hourly limit (Compose)           | per email | Emails per campaign per window (never more than the sender's cap)              |
| `RATE_LIMIT_WINDOW_MS`           | 3600000   | Window length. One hour; set e.g. `60000` to watch limits in a demo            |

**How it is enforced.** Before each send, the worker runs one Lua script in Redis (`backend/src/modules/rateLimit/rateLimiter.ts`). Because the script runs atomically, the limits hold across any number of worker processes and machines; no count lives in memory. The script:

1. Takes the sender's next free slot: now, or 2 s after the sender's previous reservation, whichever is later.
2. Checks two counters for that slot's window, keyed by window and sender, and by window and campaign.
3. Under both limits: counts the email and reserves the slot. If the slot is in the future, the job waits for it.
4. At a limit: moves the email to the **first later window with room**, behind every email already waiting there. The row becomes `delayed` with its new time, which the Scheduled list shows. Nothing is dropped or failed, and waiting uses no retry attempts.

**Order.** Emails moved into a window go first there. While any are still waiting, a newly due email queues behind them instead of going straight out, so a later email never overtakes an earlier one, even across campaigns sharing a sender.

**When a limit is reached**, a "limit reached" notification is queued once per sender (or campaign), per user, per window. Phase 8 delivers it to Slack; for now the worker logs it.

**Behaviour under load.** 1,000 emails due at the same moment on one sender (200/hour, 2 s apart) go out 200 per hour over 5 hours, 2 s apart, in order. Scheduling them takes about 0.4 s: the rows are saved and 1,000 delayed jobs added in batches. `npm run load-test -w backend` runs this scenario through the real Redis script with a simulated clock, so hours of sending are checked in about a second. It prints the per-window counts and pass/fail checks for drops, duplicates, limits, spacing and order. Options: `--emails`, `--senders`, `--campaigns`, `--sender-limit`, `--campaign-limit`, `--interval`, `--workers`, `--planned`.

**Why not BullMQ's built-in limiter?** It limits the whole queue: one sender at its cap would pause every other sender, and per-group limits are a BullMQ Pro feature. The Redis script gives each sender and campaign its own limits.

**Trade-offs.**

- Windows are fixed clock blocks, not a sliding window. Up to a full window's worth can go out on either side of a boundary, but the 2 s spacing still bounds the burst.
- An email is counted when its slot is reserved, so an attempt that fails still uses a place (conservative).
- Spacing applies to when sends start. Arrival times at the SMTP server can differ by a few hundred ms, because the first email on a new connection takes longer.
- Clocks come from the worker machines, as BullMQ's own delays do.

## Restarts and persistence

- **Jobs live in Redis**, which saves to disk (AOF), so delayed jobs survive a Redis restart.
- **Stopping the worker** (Ctrl+C / `SIGTERM`) lets in-progress sends finish before exiting.
- **After a restart**, emails that came due while everything was down are sent straight away (still 2 s apart and within the limits), and future ones at their scheduled time. Nothing starts over.
- **A crashed worker** (`kill -9`) leaves its email in `sending`. BullMQ detects the abandoned job, and the email can be claimed again once its claim is 2 minutes old.
- **MySQL is the source of truth.** When the worker starts, and whenever its Redis connection comes back, it checks every unsent email in MySQL and re-queues any that has no live job (`backend/src/queue/reconcile.ts`). This covers a crash between saving and queueing, and even a wiped Redis. It is event-driven, not a timer.

To see it: schedule a few emails a minute apart, stop the API and worker, wait until some are due, then start them again.

`SMTP_DRY_RUN=true` builds every email but never connects to SMTP: useful for load tests or working offline.

## Useful scripts

| Command                               | What it does                                                             |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`                   | Type-checks backend and frontend                                         |
| `npm run lint`                        | Lints backend and frontend                                               |
| `npm test`                            | Backend unit tests (no services needed)                                  |
| `npm run test:integration -w backend` | Integration tests against MySQL and Redis (run `npm run infra:up` first) |
| `npm run load-test -w backend`        | Rate-limiter load test (1,000 emails, simulated clock)                   |
| `npm run format`                      | Formats the repository with Prettier                                     |
| `npm run db:migrate -w backend`       | Applies migrations (creates new ones in development)                     |
| `npm run db:studio -w backend`        | Opens Prisma Studio to browse the database                               |
| `npm run seed:senders -w backend`     | Creates or updates the Ethereal senders                                  |

Integration tests use their own database (`reachinbox_test`, created and migrated automatically) and Redis database 15, so they never touch development data. They cover Google sign-in (state and PKCE, callback errors, safe return paths, sessions, logout; only the call to Google's token endpoint is faked), the rate limiter (limits, spacing, order, 200 parallel reservations), duplicate-request handling, the send claim race, and job reconciliation.

## Progress

| #   | Phase                              | Status      |
| --- | ---------------------------------- | ----------- |
| 1   | Setup and infrastructure           | Done        |
| 2   | Database and senders               | Done        |
| 3   | Core scheduling API                | Done        |
| 4   | Email worker and persistence       | Done        |
| 5   | Rate limiting and concurrency      | Done        |
| 6   | Google authentication              | Done        |
| 7   | Frontend dashboard                 | Done        |
| 8   | Slack and Elasticsearch            | Not started |
| 9   | Documentation, demo and submission | Not started |
