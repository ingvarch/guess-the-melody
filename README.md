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

1. Create the D1 database and R2 bucket, then copy the returned `database_id`
   into the `[[d1_databases]]` block of `wrangler.toml`:
   ```bash
   wrangler d1 create guess-the-melody-catalog
   wrangler r2 bucket create guess-the-melody-audio
   ```
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

### Run the importer against a local Worker

Apple answers `403` to iTunes Search requests that leave Cloudflare's network, so
importing through a **deployed** Worker fails on every track. The Worker code has
to execute on your own machine while still writing to the production D1 and R2.

`wrangler.import.toml` is a copy of `wrangler.toml` with `remote = true` on the
`CATALOG` and `AUDIO` bindings: the Worker runs locally, both bindings proxy to
production. Never deploy with it.

```bash
CLOUDFLARE_ACCOUNT_ID=<your account id> \
  wrangler dev -c wrangler.import.toml --port 8790
```

Then point the CLI at it with `ADMIN_BASE_URL=http://localhost:8790`. Writes go
straight to production — the per-track `db` timing in the log jumps from ~1 ms
(local storage) to ~150 ms (real D1), which is the quickest way to confirm the
bindings are actually remote.

A target can be either a track URL or free text:

- A line starting with `http(s)://` is resolved directly (iTunes or Spotify URL).
- Anything else is treated as an `Artist — Title` query, searched on iTunes, and
  the best-scoring playable match is auto-picked.

Auto-pick is deliberately strict, because iTunes is full of near-misses. When the
query names an artist, both sides must correspond: an artist-only hit imports the
right performer singing a different song, and a title-only hit imports a cover
band, karaoke label or lullaby rendition. The credited artist has to *lead* the
iTunes credit, so `Celtic Pink Floyd` and `Sparrow Sleeps & The Offspring` are
rejected while `Nino Rota & Carlo Savina` is kept. A rendition marker in the
iTunes title that the query never asked for (`Live`, `Remix`, `Remastered`,
`Acoustic`, `Karaoke`, …) also rejects the candidate. A leading `The` and the
Russian `ё`/`е` distinction are folded on both sides.

A strict miss is reported as `no_preview` with `no iTunes match for query`. That
usually means the original is genuinely absent from the chosen storefront — pass
the track's `music.apple.com/...?i=<id>` URL instead of loosening the query.

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
- `--delay <ms>` — pause between requests, default `500`. iTunes throttles at
  roughly 20 req/min, which is one request every three seconds — use `3000` for
  bulk runs. The server retries `403`, `429` and `503` with exponential backoff
  (6 attempts from a 2 s base, honouring `Retry-After`), because Apple answers an
  overrun client with a plain `403` rather than `429`. Pacing avoids most of it.
- `--verbose` / `-v` — also print `↷` (already `#done`) and `⊘` (already in the
  catalogue) lines. Off by default, so a re-run shows only `✔` (newly imported)
  and `✖` (genuine failures).

Curated starter lists live in `lists/` (one `Artist — Title` per line):

```bash
bun run src/cli/import.ts --genre russian-rock --country RU --file lists/russian-rock.txt
bun run src/cli/import.ts --genre russian-pop  --country RU --file lists/russian-pop.txt
bun run src/cli/import.ts --genre rock         --country US --file lists/intl-rock.txt
bun run src/cli/import.ts --genre pop          --country US --file lists/intl-pop.txt
bun run src/cli/import.ts --genre hip-hop      --country US --file lists/hip-hop.txt
```

Each line is logged as `[HH:MM:SS] <glyph> message`:

- `✔` (green) — a new track imported.
- `↷` (orange) — line already `#done`, skipped without an HTTP call.
- `⊘` (orange) — track already in the catalogue (marked `#done` now).
- `✖` (red) — a genuine failure. The line names the track that failed, since a
  failure carries no artist/title of its own.

A successful import adds a breakdown of where the time went, and a failure quotes
the source line:

```
[16:17:05] ✔ K9x2 David Bowie - Heroes (1977)
             └─ itunes 890ms · r2 1210ms · db 45ms
[16:17:08] ✖ Nirvana — Lithium — no_preview {"message":"iTunes request failed: 403"}
```

While a request is in flight a spinner line is rewritten in place on **stderr**,
so `… | tee run.log` keeps a clean result log and still animates in the terminal.
It is skipped when stderr is not a TTY.

Colour shows only on a TTY; piped/redirected output stays plain. By default `↷`
and `⊘` are hidden (they are noise on a re-run) — pass `--verbose` to see them.
The run ends with a summary line:

```
Итого: загружено 8, пропущено 142, дубликатов 0, ошибок 0
```

Fix a `✖ no_preview` miss by editing the line or replacing it with the track's
real `music.apple.com/...?i=<id>` URL.

When importing from a `--file`, every track that lands in the catalogue (a fresh
import or one that was already a duplicate) is rewritten in place with a `#done `
prefix after each line, so an interrupted run keeps its progress. Re-running the
same file skips those lines without an HTTP call and only retries the lines that
still failed. Delete the `#done ` prefix to force a re-import of a line.

## Project docs

- `CLAUDE.md` — detailed guidance for Claude Code (architecture, testing, conventions)

## Disclaimer

A hobby project, built for fun. Not affiliated with, endorsed by, or connected to
Apple Inc., Apple Music, iTunes, or Spotify AB. All product names, logos, and
trademarks are the property of their respective owners.

This app hosts no music. It caches the 30-second preview clips returned by the
public iTunes Search API, so a party game can replay them without hammering the
upstream service. Spotify links are used only to resolve metadata (artist and
title), which is then matched against iTunes — no Spotify audio is fetched or
stored.

You run your own instance, and you are responsible for complying with the terms
of every service it talks to.

## License

MIT — see [LICENSE](LICENSE).
