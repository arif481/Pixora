# Contributing

Thanks for investing time in Pixora.

## Development Setup

1. Install the supported Node.js version from [.nvmrc](.nvmrc).
2. Install dependencies with `npm ci` from the repository root.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the required values.
4. Start the app with `npm run dev:web`.

## Standard Checks

Run these from the repository root before opening a pull request:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run ci`

## Pull Request Guidelines

- Keep pull requests focused and explain the user or operational impact.
- Include screenshots or short recordings for visible UI changes.
- Call out any schema, migration, cron, or environment variable changes clearly.
- Update docs when behavior, setup, or operational procedures change.

## Database Changes

- Keep SQL changes in `db/` and make them idempotent when practical.
- Document rollout or backfill steps in the pull request when data changes are involved.
- Do not commit local-only secrets or `.env.local` files.

## Operational Changes

- Changes to worker schedules or secrets should be reflected in `.github/workflows/` and `docs/deploy-runbook.md`.
- If a change affects privacy or biometric handling, update `docs/security-privacy.md`.
