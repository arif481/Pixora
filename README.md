# Pixora

Group photo sharing where each photo goes to the people who are in it. Members enrol their face once; when someone uploads a group photo, Pixora matches the faces in it against the group's members and shares the photo with each person it finds.

Live app: https://pixora-teal-two.vercel.app

## How it works

- Face detection and embeddings run in the browser with [@vladmandic/face-api](https://github.com/vladmandic/face-api), so raw face data for enrolment and uploads is computed on the user's device.
- Enrolment asks for biometric consent first, then takes a series of captures and keeps the three most different ones (farthest-point sampling on the embeddings) as the user's templates.
- Before protected actions the app asks for a random challenge (blink twice, smile or turn your head), checks head pose and an image texture score, and compares the probe with the user's own templates.
- Uploads go straight to a private Supabase Storage bucket through signed URLs. The upload queues a job in Postgres.
- A worker, triggered every 5 minutes by a GitHub Actions cron, compares each detected face with the templates of that group's members only, using cosine similarity. A score of 0.62 or more shares the photo automatically, 0.48 to 0.62 sends it to a review queue, and a match whose lead over the second-best member is under 0.06 is treated as ambiguous. All three values can be changed with environment variables.
- Row-level security in `db/rls.sql` limits face templates to their owner, photos to group members and shares to their recipient. Detected faces in uploads are not readable by clients at all; only the server, using the service role key, reads them.

## Stack

Next.js 16 (App Router, route handlers under `/api/v1`), React 19, TypeScript, Supabase (Postgres, Auth, Storage), deployed on Vercel.

## Layout

```
apps/web/         Next.js app and API routes
db/               schema, RLS policies, seed data and migrations
docs/             architecture, API, deployment and privacy notes
openapi/          API contract
.github/workflows CI and the worker cron
```

## Running it locally

You need the Node version in [.nvmrc](.nvmrc), npm 10 or newer, and a Supabase project with `db/schema.sql` and `db/rls.sql` applied.

```bash
npm ci
cp apps/web/.env.example apps/web/.env.local   # add your Supabase and worker values
npm run dev:web
```

`npm run ci` runs lint, type checks and a production build, the same as CI. The worker cron needs two repository secrets, `PIXORA_BASE_URL` and `INTERNAL_WORKER_TOKEN`.

More detail: [architecture](docs/architecture.md), [API](docs/api-spec.md), [deployment](docs/deploy-runbook.md), [privacy and biometric data](docs/security-privacy.md).
