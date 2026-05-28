# Guess The Melody

Live party game where teams compete to guess songs from 30-second previews.
Deployed on Cloudflare Workers + Durable Objects + D1 + R2.

## What it is

A host opens a session on their phone or laptop. A display page (TV or projector)
shows a jukebox animation synced in real time. The host spins a random track from
the catalogue, teams shout answers, the host awards points, reveals the answer,
and moves to the next round.

Every session gets a short URL code. The display page is anonymous — anyone with
the link can watch. Only the host (owner cookie) can control the game.

## Tech

- Cloudflare Workers (TypeScript)
- Durable Objects with SQLite storage (session state + SSE fan-out)
- D1 (genres + tracks catalogue)
- R2 (cached iTunes audio previews)
- Workers Assets (static HTML/CSS/JS, no bundler)
- Bun (local toolchain + test runner)
- Vitest + `@cloudflare/vitest-pool-workers` (integration tests against real workerd)

## Run locally

Requires Node 22+ and Bun.

```bash
bun install
bun run dev          # wrangler dev on http://localhost:8787
```

Local dev brings up Workers, Durable Objects, D1, R2, and assets.

```bash
bun run test         # pure logic (Bun)
bun run test:worker  # Worker + DO integration (Vitest pool)
bun run test:all     # both
bun run typecheck    # strict TypeScript across all configs
```

Durable Object storage persists under `.wrangler/state/`. Delete that directory
to reset local sessions.

## Deploy

```bash
bun run deploy
```

Before first deploy:

1. Create the D1 database and R2 bucket (or use existing ones in `wrangler.toml`).
2. Apply D1 migrations remotely:
   ```bash
   wrangler d1 migrations apply guess-the-melody-catalog --remote
   ```
3. Set the admin password:
   ```bash
   wrangler secret put ADMIN_PASSWORD
   ```

The first deploy applies the `[[migrations]]` entry to create the `MelodyRoom`
Durable Object class. Subsequent DO class changes require a new migration tag.

## Import tracks

Use the admin web UI at `/admin` (basic auth with `ADMIN_PASSWORD`) or the CLI:

```bash
bun run src/cli/import.ts "https://music.apple.com/..." rock
```

The importer fetches metadata and artwork from iTunes, downloads the 30-second
preview, uploads it to R2, and inserts the track into D1.

## Project docs

- `CLAUDE.md` — detailed guidance for Claude Code (architecture, testing, conventions)
- `HANDOFF.md` — implementation phases, open work, lessons learned
- `docs/plans/` — design documents and roadmap (untracked, see `.gitignore`)
