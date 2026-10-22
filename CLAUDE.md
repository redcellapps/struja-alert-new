# Struja Alert

Expo (Android first, iOS later) + Fastify/Postgres app that pushes a notification when EDS announces a planned outage for a saved address in Serbia. Full spec: `BRIEF.md`. Approved plan: `docs/PLAN.md`. Work phase by phase; stop for review at the end of each.

## Commands
- `pnpm install` · `pnpm lint` · `pnpm typecheck` · `pnpm test` (all must be green before a phase is done)
- `docker compose -f docker/compose.yaml up -d` — local Postgres/PostGIS
- `pnpm --filter @struja/server dev` — API on :3000 (`/healthz`)
- `cd apps/mobile && npx expo run:android` — dev build on emulator/phone

## Layout
`apps/mobile` (Expo) · `apps/server` (Fastify) · `packages/parser` (pure TS, no I/O) · `packages/shared` (zod schemas, constants) · `fixtures/` · `scripts/` · `docs/`

## Conventions
- TypeScript strict, zero lint warnings. Prettier (`BRIEF.md`, `docs/PLAN.md` are excluded; don't reformat them).
- Scripts must run on Windows and macOS: no bash-only syntax in `package.json`; tooling in TypeScript/Node. LF line endings.
- Never pin library versions from memory; check current docs. Install Expo packages with `npx expo install`.
- Parse saved fixtures, never the live site. Only the fixture collector and the production scheduler may request elektrodistribucija.rs.
- `.platform.tsx` files only where native chrome differs; logic and data stay shared. Mark Mac-only work **[MAC]**.
- If reality contradicts the brief, stop and tell the user.

## Non-negotiables (BRIEF §8)
- No webview. App is unofficial and not affiliated with EPS/EDS; credit EDS as the source.
- No accounts, no location permission, no tracking SDKs.
- `notification_log` `UNIQUE(subscription_id, outage_id, kind)` is never dropped.
- No external or paid AI/LLM APIs in the running system.
- The raw `Ulice` cell is always stored.
- Every parser/matcher bug gets a fixture-based regression test.
- Prefer false positives to false negatives when matching.
- Never commit secrets; `.env` is git-ignored, `.env.example` documents variables. Scraper User-Agent contact comes from `SCRAPER_CONTACT_EMAIL`.
- Ask before: `git push`, ssh/scp, `eas build/submit/workflow:run`, any deploy, installing Maestro.
