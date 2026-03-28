# Pixora Web App

The web app is a Next.js application that serves both the product UI and the `/api/v1/*` backend routes used by the product.

## Local Setup

1. Copy `.env.example` to `.env.local`
2. Fill in the required Supabase and worker values
3. Install dependencies from the repository root with `npm ci`
4. Start the app from the repository root:
   - `npm run dev:web`

## Commands

- `npm run dev -w apps/web`
- `npm run lint -w apps/web`
- `npm run typecheck -w apps/web`
- `npm run build -w apps/web`

## Responsibilities

- Authentication UI and bearer-token forwarding
- Face enrollment and live verification experiences
- Group creation, membership, and photo upload flows
- Share listing and access control
- Internal worker trigger endpoint

## Environment Variables

See [.env.example](.env.example) for the current set of supported variables, including:

- Supabase client and service credentials
- worker authentication
- enrollment thresholds
- live verification thresholds
- matching and auto-share thresholds

## Operational Notes

- The production worker should call `POST /api/v1/internal/process-next`
- The scheduled GitHub workflow lives at [process-worker-cron.yml](../../.github/workflows/process-worker-cron.yml)
- Deployment steps and required infrastructure are documented in [deploy-runbook.md](../../docs/deploy-runbook.md)
