# Deployment Plan (Free Tier)

## Target architecture

- **Vercel Hobby**: Next.js web app + API routes (lightweight orchestration).
- **Supabase Free**: Postgres, Auth, Storage.
- **Render/Railway Free**: FastAPI face engine service.

## Environment variables

### Web app

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FACE_ENGINE_URL`
- `FACE_ENGINE_TOKEN`
- `AUTO_SHARE_THRESHOLD` (default `0.62`)
- `REVIEW_MIN_THRESHOLD` (default `0.48`)

### Face engine

- `ENGINE_AUTH_TOKEN`
- `MODEL_NAME` (e.g., `buffalo_l`)
- `MAX_IMAGE_MB` (default `15`)

## Rollout steps

1. Provision Supabase project and buckets (`photos-private`, `thumbs-private`, `enrollment-private`).
2. Run SQL migrations (`db/schema.sql`, `db/rls.sql`).
3. Deploy face engine service from `services/face-engine`.
4. Deploy Next.js app and configure env vars.
5. Run smoke tests: enrollment, group upload, auto-share, review flow.

## Free-tier guardrails

- Enforce per-user daily upload caps.
- Downscale large images on client before upload.
- Process queue with concurrency=1-2 initially.
- Purge temporary files and stale enrollment sessions daily.

## Observability

- Log structured events with request id and photo id.
- Build dashboard for:
  - Processing latency
  - Auto-share count
  - Review queue size
  - Reject ratio by confidence bucket
