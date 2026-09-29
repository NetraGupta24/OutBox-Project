# ReachInbox Email Job Scheduler

A full-stack email scheduler: an Express + BullMQ backend that schedules and sends emails through Ethereal SMTP, and a Next.js dashboard to compose, schedule and track them.

> Work in progress. The full design is in [`docs/PROJECT_REPORT.md`](docs/PROJECT_REPORT.md).

## Tech stack

| Layer | Technology |
|---|---|
| Backend | TypeScript, Express.js |
| Queue | BullMQ on Redis |
| Database | MySQL 8 |
| Search | Elasticsearch 8 |
| Email | Ethereal Email (SMTP) |
| Frontend | Next.js (App Router), React, Tailwind CSS, TypeScript |
| Infra | Docker Compose for MySQL, Redis and Elasticsearch |

## Repository layout

```
backend/    Express API (src/server.ts) and worker process (src/worker.ts)
frontend/   Next.js dashboard
docs/       Project report and design notes
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
# then set ENCRYPTION_KEY in backend/.env to the output of: openssl rand -hex 32

# 4. Create the database tables
npm run db:migrate -w backend

# 5. Create the Ethereal sender accounts (see "Ethereal setup" below)
npm run seed:senders -w backend

# 6. Run each process in its own terminal
npm run dev:api      # API on http://localhost:4000
npm run dev:worker   # BullMQ worker process
npm run dev:web      # Dashboard on http://localhost:3000
```

Check that everything is connected: `curl http://localhost:4000/health` (reports MySQL, Redis and Elasticsearch), or open http://localhost:3000.

The frontend proxies `/api/*` to the backend (see `frontend/next.config.ts`), so the browser only talks to one origin.

### Infrastructure notes

- **Redis** runs with `appendonly yes` (AOF persistence), so delayed jobs survive a restart, and with `maxmemory-policy noeviction`, which BullMQ requires.
- **Elasticsearch** runs as a single node with security disabled and a 512 MB heap, for local development only.
- **MySQL** runs `docker/mysql/init.sql` when its volume is first created. It lets the app user create the temporary database `prisma migrate dev` needs.
- All data lives in named Docker volumes. `npm run infra:down` stops the containers and keeps the data.

## Ethereal setup

[Ethereal](https://ethereal.email) is a fake SMTP service: it accepts emails and shows them in a web inbox, but never delivers them. The app sends from several Ethereal accounts ("senders").

- **Automatic:** `npm run seed:senders -w backend` creates `SEED_SENDER_COUNT` accounts (default 3) through Nodemailer's API.
- **Manual:** create accounts at https://ethereal.email, then set `ETHEREAL_SENDERS="user1@ethereal.email:pass1,user2@ethereal.email:pass2"` in `backend/.env` and run the same command.

Add `-- --verify` to check each SMTP login. The script is safe to re-run. Passwords are stored encrypted (AES-256-GCM with `ENCRYPTION_KEY`).

## Database

MySQL is the source of truth. The schema lives in `backend/prisma/schema.prisma`, and migrations in `backend/prisma/migrations`.

| Table | Purpose |
|---|---|
| `users` | Google accounts that have signed in |
| `senders` | SMTP accounts emails are sent from (encrypted passwords) |
| `campaigns` | One Compose submission: subject, body, start time, delay, hourly limit |
| `emails` | One row per recipient, with status `scheduled → sending → sent/failed` (or `delayed` when rate-limited) |
| `slack_integrations` | Per-user Slack webhook (encrypted) for rate-limit alerts |

Key constraints: `emails(campaign_id, recipient)` is unique, so a lead can't be scheduled twice in one campaign, and `campaigns(user_id, idempotency_key)` is unique, so a double-clicked Schedule creates one campaign.

All times are stored in UTC.

## Useful scripts

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks backend and frontend |
| `npm run lint` | Lints backend and frontend |
| `npm run format` | Formats the repository with Prettier |
| `npm run db:migrate -w backend` | Applies migrations (creates new ones in development) |
| `npm run db:studio -w backend` | Opens Prisma Studio to browse the database |
| `npm run seed:senders -w backend` | Creates or updates the Ethereal senders |

## Progress

| # | Phase | Status |
|---|---|---|
| 1 | Setup and infrastructure | Done |
| 2 | Database and senders | Done |
| 3 | Core scheduling API | Not started |
| 4 | Email worker and persistence | Not started |
| 5 | Rate limiting and concurrency | Not started |
| 6 | Google authentication | Not started |
| 7 | Frontend dashboard | Not started |
| 8 | Slack and Elasticsearch | Not started |
| 9 | Documentation, demo and submission | Not started |
