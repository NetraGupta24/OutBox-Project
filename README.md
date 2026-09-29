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

# 4. Run each process in its own terminal
npm run dev:api      # API on http://localhost:4000
npm run dev:worker   # BullMQ worker process
npm run dev:web      # Dashboard on http://localhost:3000
```

Check that everything is connected: `curl http://localhost:4000/health`, or open http://localhost:3000.

The frontend proxies `/api/*` to the backend (see `frontend/next.config.ts`), so the browser only talks to one origin.

### Infrastructure notes

- **Redis** runs with `appendonly yes` (AOF persistence), so delayed jobs survive a restart, and with `maxmemory-policy noeviction`, which BullMQ requires.
- **Elasticsearch** runs as a single node with security disabled and a 512 MB heap, for local development only.
- All data lives in named Docker volumes. `npm run infra:down` stops the containers and keeps the data.

## Useful scripts

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-checks backend and frontend |
| `npm run lint` | Lints backend and frontend |
| `npm run format` | Formats the repository with Prettier |

## Progress

| # | Phase | Status |
|---|---|---|
| 1 | Setup and infrastructure | Done |
| 2 | Database and senders | Not started |
| 3 | Core scheduling API | Not started |
| 4 | Email worker and persistence | Not started |
| 5 | Rate limiting and concurrency | Not started |
| 6 | Google authentication | Not started |
| 7 | Frontend dashboard | Not started |
| 8 | Slack and Elasticsearch | Not started |
| 9 | Documentation, demo and submission | Not started |
