# Pixora

Privacy-first group photo sharing powered by face enrollment, live verification, and face matching.

## Repository Layout

- `apps/web` — Next.js web app and API routes
- `db` — PostgreSQL schema, RLS policies, seed data, and migrations
- `docs` — product, architecture, API, deployment, and privacy documentation
- `openapi/openapi.yaml` — API contract snapshot
- `.github` — CI, cron, ownership, and contributor workflow files

## Prerequisites

- Node.js from [.nvmrc](.nvmrc)
- npm `>=10`
- Supabase project credentials for local development

## Quick Start

1. Install dependencies from the repository root:
   - `npm ci`
2. Copy `apps/web/.env.example` to `apps/web/.env.local`
3. Fill in the required Supabase and worker values
4. Start the web app:
   - `npm run dev:web`

## Standard Commands

- `npm run dev:web` — run the Next.js app locally
- `npm run lint` — run ESLint for the web app
- `npm run typecheck` — run TypeScript checks
- `npm run build` — create a production build
- `npm run ci` — run the default repository quality gate

## Core Product Flows

- Face enrollment with biometric consent
- Live face verification before protected actions
- Group creation and membership flows
- Browser-side face detection on photo upload
- Worker-driven face matching and share creation

## Deployment And Operations

- Deployment checklist: [deploy-runbook.md](docs/deploy-runbook.md)
- Privacy and biometric guidance: [security-privacy.md](docs/security-privacy.md)
- Architecture overview: [architecture.md](docs/architecture.md)
- API expectations: [api-spec.md](docs/api-spec.md)

## GitHub Automation

- CI runs on pushes to `main` and on pull requests
- Dependency updates are configured with Dependabot
- Worker processing is triggered by `.github/workflows/process-worker-cron.yml`

Required repository secrets for the worker cron:

- `PIXORA_BASE_URL`
- `INTERNAL_WORKER_TOKEN`

## Working In This Repo

- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)

## Notes

- Local-only files such as `.env.local`, `.vercel/`, and virtual environments should stay uncommitted.
