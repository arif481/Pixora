# Pixora Web App

## Run locally

1. Copy `.env.example` to `.env.local` and fill values.
2. Install dependencies:
   - From repo root: `npm install`
3. Start dev server:
   - `npm run dev:web`

## Current scaffold status

- Group creation/listing
- Group photo upload + registration flow
- Enrollment UI with face-engine backed completion route
- Shared-with-me feed
- Supabase-backed API routes under `app/api/v1/*`
- Processing worker pipeline (`processing_jobs` -> detect -> match -> share/review)
- JWT-based API user resolution from Supabase bearer token
- Client auth UI (email/password sign-in/sign-up) with bearer token forwarding on API requests

## Next integration steps

- Add scheduled trigger (Vercel cron/GitHub Actions) to call `POST /api/v1/internal/process-next`.
- Add confidence tuning and duplicate-face suppression strategies.

## Auth behavior

- Production mode expects `Authorization: Bearer <supabase_access_token>`.
- Optional local fallback can be enabled with `ALLOW_DEMO_USER=true` (uses `x-user-id`/`DEMO_USER_ID`).

## Trigger worker manually

Use your worker token in the Authorization header:

`curl -X POST http://localhost:3000/api/v1/internal/process-next -H "Authorization: Bearer $INTERNAL_WORKER_TOKEN"`

## GitHub cron

Use `.github/workflows/process-worker-cron.yml` to trigger the worker in production.
