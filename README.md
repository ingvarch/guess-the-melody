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

The importer resolves a track to a 30-second iTunes preview, uploads it to R2,
and inserts the row into D1. Use the admin web UI at `/admin` (basic auth with
`ADMIN_PASSWORD`) or the CLI.

The CLI posts to a running Worker. It reads two env vars:

- `ADMIN_PASSWORD` (required) — admin basic-auth password.
- `ADMIN_BASE_URL` (optional) — Worker base URL, default `http://localhost:8787`.

A target can be either a track URL or free text:

- A line starting with `http(s)://` is resolved directly (iTunes or Spotify URL).
- Anything else is treated as an `Artist — Title` query, searched on iTunes, and
  the best-scoring playable match is auto-picked.

```bash
# single iTunes/Spotify URL
bun run src/cli/import.ts --genre rock "https://music.apple.com/...?i=123"

# free-text query
bun run src/cli/import.ts --genre rock "Queen — Bohemian Rhapsody"

# bulk from a file, one target per line (# comments and blanks skipped)
bun run src/cli/import.ts --genre russian-rock --country RU --file lists/russian-rock.txt
```

Flags:

- `--genre <slug>` (required) — existing genre slug (see `db/migrations`).
- `--file <path>` — read targets from a file.
- `--country <XX>` — iTunes storefront for search (`RU` for Russian artists,
  `US` for international). Omit to use the default store.
- `--itunes-id <n>` — force a specific iTunes track id (single-URL use).
- `--delay <ms>` — pause between requests, default `500`. iTunes throttles
  (~20 req/min); the server also retries on 429 with backoff, but pacing avoids
  most retries. Raise to `3000` if you still hit rate limits.
- `--verbose` / `-v` — also print `[SKIP]` (already `#done`) and `[DUP]`
  (already in the catalogue) lines. Off by default, so a re-run shows only
  `[OK]` (newly imported) and `[ERR]` (genuine failures).

Curated starter lists live in `lists/` (one `Artist — Title` per line):

```bash
bun run src/cli/import.ts --genre russian-rock --country RU --file lists/russian-rock.txt
bun run src/cli/import.ts --genre russian-pop  --country RU --file lists/russian-pop.txt
bun run src/cli/import.ts --genre rock         --country US --file lists/intl-rock.txt
bun run src/cli/import.ts --genre pop          --country US --file lists/intl-pop.txt
bun run src/cli/import.ts --genre hip-hop      --country US --file lists/hip-hop.txt
```

Each line is logged as `[HH:MM:SS] [TAG] message`, where `TAG` is one of:

- `[OK]` (green) — a new track imported.
- `[SKIP]` (orange) — line already `#done`, skipped without an HTTP call.
- `[DUP]` (orange) — track already in the catalogue (marked `#done` now).
- `[ERR]` (red) — a genuine failure (e.g. `no_preview`).

Colour shows only on a TTY; piped/redirected output stays plain. By default
`[SKIP]` and `[DUP]` are hidden (they are noise on a re-run) — pass `--verbose`
to see them. The run ends with a summary line:

```
Итого: загружено 8, пропущено 142, дубликатов 0, ошибок 0
```

Fix an `[ERR] no_preview` miss by editing the line or replacing it with the
track's real `music.apple.com/...?i=<id>` URL.

When importing from a `--file`, every track that lands in the catalogue (a fresh
import or one that was already a duplicate) is rewritten in place with a `#done `
prefix after each line, so an interrupted run keeps its progress. Re-running the
same file skips those lines without an HTTP call and only retries the lines that
still failed. Delete the `#done ` prefix to force a re-import of a line.

## Project docs

- `CLAUDE.md` — detailed guidance for Claude Code (architecture, testing, conventions)
- `HANDOFF.md` — implementation phases, open work, lessons learned
- `docs/plans/` — design documents and roadmap (untracked, see `.gitignore`)
