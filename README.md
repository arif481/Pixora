# Pixora

Privacy-first group photo sharing powered by face verification and face matching.

## Repo structure

- `apps/web` — Next.js web app + API route stubs for MVP flows
- `services/face-engine` — FastAPI face engine starter (stub inference)
- `db` — PostgreSQL schema, RLS, and seed data for Supabase
- `docs` — architecture, product spec, API spec, deployment, implementation plan
- `openapi/openapi.yaml` — API contract starter

## Run locally

### 1) Web app

1. `cd apps/web`
2. Copy `.env.example` to `.env.local`
3. `npm install`
4. `npm run dev`

### 2) Face engine

1. `cd services/face-engine`
2. Create and activate a virtual environment
3. `pip install -r requirements.txt`
4. Copy `.env.example` to `.env`
5. `bash run.sh`

## MVP scaffolding included

- Face enrollment flow with consent check and face-engine integration
- Group create/list UI backed by Supabase
- Group photo upload-url + registration flow backed by Supabase
- Shares feed backed by Supabase
- Enrollment session validation and template persistence

## Next production wiring steps

1. Run SQL scripts in `db/` and enforce RLS policies.
2. Provision storage buckets (`photos-private`, `thumbs-private`, `enrollment-private`).
3. Configure scheduler to call `POST /api/v1/internal/process-next` with worker token.
4. Deploy per `docs/deploy-free-tier.md`.

## GitHub scheduler setup

Workflow file: `.github/workflows/process-worker-cron.yml`

Configure these repository secrets in GitHub:

- `PIXORA_BASE_URL` (example: `https://your-app.vercel.app`)
- `INTERNAL_WORKER_TOKEN` (must match `apps/web/.env.example` value in your deployed app env)

The workflow runs every minute and can also be triggered manually from GitHub Actions.
