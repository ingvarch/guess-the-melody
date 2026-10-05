# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

"Guess The Melody" — a live party game server deployed to Cloudflare Workers + Durable Objects + D1 + R2.

The host (judge) runs the game from the private console at `/admin/console/<id>` (basic-auth) and the room watches `/s/<id>/display` — the jukebox view shown on a TV or projector, which also carries the audio. A bare `/s/<id>/` redirects to that display. Every game is its own session identified by a short code in the URL (`/s/ABC123/`). One Durable Object instance per session holds the authoritative state and the set of SSE subscribers.

Sessions are ephemeral: they live as long as they are in use, keep a snapshot in DO storage so page reloads rehydrate, and can be reset (new game) any number of times without creating a new session.

A track catalogue lives in D1 (genres + tracks). Tracks are imported from iTunes/Spotify URLs or free-text `Artist — Title` queries (auto-matched to an iTunes preview) via the admin API or a CLI script; audio previews are cached in R2. Curated starter lists live in `lists/`. The host spins a random track, teams shout answers, the host awards points, reveals the track, and moves to the next round.

## Non-negotiable principles

These come from the user's global policy. Violating any of them is a rework, not a patch.

### Test-Driven Development

No feature or bugfix code lands without a failing test first.

1. Write a failing test that describes the expected behaviour.
2. Watch it fail for the right reason.
3. Write the minimum code to make it pass.
4. Refactor with the test green.

There are no "too simple to test" exceptions. Pure logic goes into `public/static/js/logic.js` and is covered by Bun's built-in `bun:test` using the `node:test` API. Worker + Durable Object behaviour is covered with Vitest + `@cloudflare/vitest-pool-workers` so it runs against the real Workers runtime.

### Root cause only

Forbidden:

- "Temporarily disable this" — nothing is temporary.
- "Add a flag to skip it" — flags to bypass broken behaviour are never solutions.
- "Suppress the warning" — warnings exist for a reason.
- "Comment it out for now" — dead code is not a fix.

When stuck more than two or three attempts, stop and explain to the user what fails, what was tried, and what information is missing. Never ship a workaround labelled as a fix.

### Impact analysis, vertical and horizontal

Before touching code, trace:

- Vertical — who calls this, and what does this call? What depends on the return value or side effects?
- Horizontal — what sibling modules or components live at the same layer? A schema change, a renamed symbol, a new field on state — all of these hit siblings.

Write findings down before writing code. If the blast radius is large, flag it and confirm scope before proceeding.

### Clean code

- KISS: simplest solution that works, no clever tricks.
- DRY: extract when the same logic appears twice. Do not pre-extract.
- YAGNI: build only what the current task requires. Do not add parameters, flags, or abstractions "for the future".
- Single responsibility: one function, one job.
- Composition over inheritance.
- Dead code is deleted, not commented out.
- If a function needs a comment to explain what it does, rename or split it.

### Apple Human Interface Guidelines

All UI decisions follow Apple HIG. The display page is optimised for a projector (dark, high-contrast, large type, tabular numerals). The admin page reads on phone and laptop. The host UI is warm-paper themed with `@media (hover: hover)` gates so hover states do not stick on touch.

### Git

- Conventional Commits only. Scope examples: `web`, `worker`, `do`, `ui`, `assets`, `config`, `tests`, `catalog`, `admin`.
- The user always runs git commands. Claude proposes the commit message; the user runs it.
- Never skip hooks (`--no-verify`, `--no-gpg-sign`) unless explicitly asked.

### Documents

No emojis in any document (`README.md`, `CLAUDE.md`, comments in config files, etc.).

## Architecture

```
Browser (host console at            Browser (display at /s/<id>/display)
         /admin/console/<id>)
        |                                          |
        | POST /api/state  (JSON)                  | GET /api/events (SSE)
        | GET  /api/state                          |
        v                                          v
                Cloudflare Worker (src/index.ts)
                       router + auth
                              |
                              v
           Durable Object  MelodyRoom  (one per session)
             - state snapshot (in memory + SQLite storage)
             - Set<ReadableStreamDefaultController> for SSE fan-out
             - owner token check for writes
```

### Request flow

- `GET /` — serves `public/index.html` from Assets. Landing page with a vinyl SVG; "Start game" creates a session.
- `POST /api/session` — Worker picks a short session id, creates the MelodyRoom DO for it, installs the owner token, returns `{ sessionId }`. Owner token is set in an `HttpOnly; Secure; Path=/s/<id>/` cookie.
- `GET /s/<id>/` — 302 to `/s/<id>/display`. The host console lives behind admin auth at `/admin/console/<id>`.
- `GET /s/<id>/display` — serves `display.html`. No auth. Reads via `/s/<id>/api/state` and subscribes to `/s/<id>/api/events` for live updates.
- `POST /s/<id>/api/state` — host pushes new state (team add/remove/rename, spin, play, reveal, award, next, endgame). Requires owner cookie. The DO stores it and broadcasts to all SSE subscribers.
- `GET /s/<id>/api/events` — SSE stream. Initial state on connect, then every `setState`. `: keep-alive\n\n` heartbeat every 25 seconds while at least one subscriber is active (auto-stops on empty room). Subscribers removed on disconnect or write failure.
- `GET /s/<id>/api/track/<id>.mp3` — streams the cached preview from R2. Immutable cache headers.
- `GET /s/<id>/qr.svg` — server-rendered SVG QR code of the display URL. Cached by the edge for 1h via `Cache-Control: max-age=3600`.
- `/admin*` — basic-auth gated admin surface. Serves `admin.html` and handles `/admin/api/genres`, `/admin/api/tracks`, `/admin/api/import`, `/admin/api/sessions` (read-only Live Game registry).
- `GET /api/genres` — public genre list (non-archived, sorted by `sort_order`).

### Session lifecycle

- A session is a DO instance, keyed by session id.
- DO keeps state in memory and snapshots to SQLite storage on every mutation so a cold start rehydrates last state.
- New game inside the session resets state but keeps the session id.
- No explicit delete — sessions age out with DO idle eviction. That is fine for this use case.

### Auth

- Admin writes require the owner cookie created at `POST /api/session`.
- Display and read endpoints are anonymous — anyone with the session URL can watch.
- The session id is unguessable (10 URL-safe chars, ~60 bits of entropy). That is the entire access-control surface; anyone with the URL can watch, only the cookie holder can write.
- Admin endpoints (`/admin/*`) are gated by HTTP Basic Auth against `env.ADMIN_PASSWORD`. Username is ignored; only the password is compared in constant time.

### Rate limiting

`POST /api/session` is throttled per client IP via the optional `SESSION_RATE_LIMITER` binding (Cloudflare's built-in rate-limit API, configured under `[[ratelimits]]` in `wrangler.toml`). Default limit is 60 sessions per minute per IP. Tests skip the check when the binding isn't bound, so local dev and CI run unconstrained.

## Tech stack

- Cloudflare Workers runtime, TypeScript for the server code.
- Durable Objects with SQLite storage class.
- D1 for relational data (genres, tracks).
- R2 for audio preview objects.
- Static assets served from `public/` via the Workers Assets binding. No bundler for client code — native ES modules. Wrangler bundles the Worker; client code ships as-is.
- Wrangler for dev and deploy. Config is TOML (`wrangler.toml`).
- `compatibility_date` is pinned; bump it when a runtime feature we want lands.
- Bun is the local toolchain: package install, script runner, and test runner. The Worker still runs on `workerd` in production — Bun never touches the runtime, only the host tooling.
- Tests: `bun test` for pure client logic (uses `bun:test` with `node:test` API). Vitest + `@cloudflare/vitest-pool-workers` for Worker + DO behaviour. Vitest is invoked via `bun run vitest` and spawns a real `workerd` under the hood, so test fidelity matches production.

## Directory structure

```
guess-the-melody/
├── CLAUDE.md
├── README.md
├── wrangler.toml                  # deployment config (TOML)
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── tsconfig.cli.json
├── vitest.config.ts
├── .gitignore
├── db/
│   └── migrations/                # D1 schema + seed migrations
├── src/
│   ├── index.ts                   # Worker entry: router + DO re-export
│   ├── router.ts                  # path -> handler table
│   ├── session.ts                 # session id generation, cookie helpers
│   ├── melody-room.ts             # Durable Object class
│   ├── auth.ts                    # basic-auth + owner-token parsing
│   ├── id.ts                      # random URL-safe id helper
│   ├── qr.ts                      # QR code generation
│   ├── audio-serve.ts             # shared R2 audio serving (Range, ETag, stored type)
│   ├── spin-boost.ts              # host-private genre boost decision for auto spins
│   ├── types.ts                   # shared Env interface + state shapes
│   ├── catalog/
│   │   ├── genres.ts              # D1 access layer for genres
│   │   ├── tracks.ts              # D1 access layer for tracks
│   │   └── sessions.ts            # D1 active-session registry (admin Live Game)
│   ├── admin/
│   │   └── handlers.ts            # basic-auth gated admin API
│   ├── importer/
│   │   ├── import-track.ts        # track import orchestrator (url | query | itunes-id)
│   │   ├── itunes.ts              # iTunes search/lookup + 429 backoff
│   │   ├── spotify.ts             # Spotify URL parsing
│   │   ├── match.ts              # free-text query parsing + iTunes auto-pick scoring
│   │   ├── audio-type.ts          # container sniffing (m4a vs mp3) from preview bytes
│   │   └── r2.ts                  # R2 upload helpers
│   └── cli/
│       └── import.ts              # Bun CLI for bulk import (URLs or "Artist — Title" lines)
├── public/
│   ├── index.html                 # landing page
│   ├── display.html               # display (jukebox) shell — the audio surface
│   ├── console.html               # host console shell (served under /admin)
│   ├── admin.html                 # admin UI shell
│   └── static/
│       ├── css/
│       │   ├── base.css           # tokens, buttons, resets
│       │   ├── landing.css        # landing layout
│       │   └── admin.css          # admin + console styles
│       └── js/
│           ├── logic.js           # pure state machine (portable, tested)
│           ├── state.js           # state shape + mutators
│           ├── prng.js            # mulberry32 PRNG
│           ├── audio-sync.js      # audio time-sync helpers
│           ├── waveform.js        # canvas waveform visualiser
│           ├── sse.js             # reconnecting EventSource wrapper
│           ├── sound-gate.js      # autoplay gate + tap-for-sound overlay
│           ├── host-actions.js    # game API wrappers
│           ├── display-ui.js      # display DOM rendering
│           ├── console-ui.js      # host console DOM rendering
│           ├── admin-ui.js        # admin DOM rendering
│           ├── admin-api.js       # admin API wrappers
│           ├── main-landing.js    # landing bootstrap
│           ├── main-display.js    # display bootstrap
│           ├── main-console.js    # host console bootstrap
│           └── main-admin.js      # admin bootstrap
└── tests/
    ├── js/                        # Bun tests (node:test API)
    │   ├── logic.test.mjs
    │   ├── state.test.mjs
    │   ├── prng.test.mjs
    │   ├── audio-sync.test.mjs
    │   ├── waveform.test.mjs
    │   ├── sse.test.mjs
    │   ├── sound-gate.test.mjs
    │   ├── host-actions.test.mjs
    │   ├── display-ui.test.mjs
    │   ├── console-ui.test.mjs
    │   ├── admin-ui.test.mjs
    │   ├── admin-api.test.mjs
    │   ├── auth.test.mjs
    │   ├── session.test.mjs
    │   ├── main-landing.test.mjs
    │   └── cli-import.test.mjs
    └── worker/                    # Vitest + workers pool
        ├── melody-room.spec.ts
        ├── router.spec.ts
        ├── catalog-genres.spec.ts
        ├── catalog-tracks.spec.ts
        ├── catalog-sessions.spec.ts
        ├── admin.spec.ts
        ├── import-track.spec.ts
        ├── itunes.spec.ts
        ├── spotify.spec.ts
        ├── match.spec.ts
        ├── r2.spec.ts
        ├── audio-serve.spec.ts
        ├── audio-type.spec.ts
        ├── spin-boost.spec.ts
        └── health.spec.ts
```

## Development workflow

```bash
bun install
bun run dev               # wrangler dev — local Workers + DO + D1 + R2 + assets
bun test tests/js/        # pure logic, runs under Bun
bun run test:worker       # vitest against workers pool (real workerd)
bun run test:all          # both suites
bun run typecheck         # tsc --noEmit across all three tsconfigs
```

`bun.lock` is committed (Bun's text lockfile). Do not also generate a `package-lock.json`; pick one tool.

Wrangler v3.91.0+ also supports JSON/JSONC for config; this project deliberately uses TOML because the user asked for it.

Local dev hot-reloads both the Worker and static assets. Durable Object storage in `wrangler dev` persists under `.wrangler/state/`; to reset a local session, delete that directory.

## Deployment

```bash
bun run deploy            # wrangler deploy
bun run deploy:staging    # wrangler deploy --env staging
```

Production deploys to the `name` in `wrangler.toml`. Secrets go through `wrangler secret put <NAME>`. Never commit secrets; never put sensitive values under `[vars]`.

Required secret: `ADMIN_PASSWORD` — used by `/admin` basic auth.

The first deploy applies the `[[migrations]]` to create the `MelodyRoom` Durable Object class. Every later change to that class — rename, add new DO class, delete — must add a new migration entry with a fresh `tag`. Do not modify an already-applied migration.

D1 migrations are applied locally via `wrangler d1 migrations apply --local` (handled by `wrangler dev`). For production/staging, run `wrangler d1 migrations apply --remote` separately.

## Cloudflare guidance

### Durable Objects

- One DO class, `MelodyRoom`, backed by SQLite storage. SQLite-backed DOs are the modern default; use `new_sqlite_classes` in migrations.
- Do not create a new DO per request. Obtain the stub with `env.MELODY_ROOM.idFromName(sessionId)` and `env.MELODY_ROOM.get(id)`.
- Keep hot state in memory on the DO instance. Persist the latest snapshot to `ctx.storage` on every mutation so a reboot rehydrates.
- SSE subscribers are held as in-memory controllers. A DO eviction drops them; clients must reconnect with backoff (implemented in the display and host bootstraps via `EventSource`).

### Server-Sent Events on Workers

- Return a `ReadableStream` with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- Emit a heartbeat comment (`: keep-alive`) every 25 seconds to keep intermediaries from closing the connection.
- Do not rely on `close`-detection on the server; prune dead controllers when a `controller.enqueue` throws.

### Assets

- `public/` is served through the Assets binding. The Worker script sees only the paths listed in `assets.run_worker_first` (i.e. `/api/*`, `/s/*`, `/admin/*`). Everything else is served as a static file without billing a Worker invocation.
- `html_handling = "auto-trailing-slash"` resolves `/display` to `public/display.html` and `/` to `public/index.html`.
- For session-scoped URLs (`/s/<id>/` and `/s/<id>/display`), the Worker script rewrites to the base HTML and injects the session id at runtime. See `src/router.ts`.

### D1

- D1 does not enforce foreign keys at runtime. The `REFERENCES` clause on `tracks.genre_slug` is documentation only.
- Genre deletion is guarded by a track-count check in the admin handler layer.
- Use `json_each` to bind arrays as single parameters, avoiding dynamic `IN (...)` SQL stitching.

### Compatibility date

Pinned in `wrangler.toml`. To adopt a newer runtime feature, bump the date and update this document with what changed. Do not bump casually.

## Testing strategy

- Pure logic in `public/static/js/logic.js` — mandatory `bun test` coverage. Tests live in `tests/js/` and use the `node:test` API (`import { test, expect } from "node:test"`). Bun natively supports this API.
- State mutators in `public/static/js/state.js` — same.
- Worker routes and DO behaviour — Vitest + `@cloudflare/vitest-pool-workers`. Tests live in `tests/worker/` and run against a real `workerd` instance with its own SQLite-backed DO storage and D1.
- Three TS configs:
  - `tsconfig.json` — `src/` only, types `["@cloudflare/workers-types"]`. Worker code must not see Bun globals.
  - `tsconfig.test.json` — `tests/` + `src/`, types `["@types/bun", "@cloudflare/workers-types"]`. Test files can use `bun:test` and Workers types where they overlap with vitest.
  - `tsconfig.cli.json` — `src/cli/` + `src/importer/`, types `["@types/bun"]`. CLI scripts can use Bun APIs.
- Never mock what you can test for real. No stubs of the Durable Object — spin up the real one under Vitest. No mocks of D1 — use `applyD1Migrations` in the workers pool.

## Gotchas

- `display.html` links no local stylesheet: its CSS lives in the page's own inline `<style>` block (Tailwind CDN supplies the rest). Rules written into a file under `static/css/` will silently not apply there. `console.html` and `admin.html` do link `base.css`, so shared control styling belongs in both places.
- The display's write actions need the session's owner cookie (`Path=/s/<id>/`, 24h). A display opened on another device or after the cookie expires can still show every control while every POST 403s. Failures are surfaced by `showActionError`; never swallow them again.
- A Durable Object can be evicted at any time. Do not store authoritative state only in memory. Snapshot to `ctx.storage` on every mutation. Treat memory as a cache of storage.
- SSE clients disconnect silently on mobile (screen lock, network switch). Always include auto-reconnect with backoff on the client. `EventSource` does this natively.
- Workers have a per-invocation CPU-ms limit. The game logic is fast; if a hot path ever grows, profile it, do not add a worker-level cap.
- The `assets` binding refuses to serve files under `run_worker_first` patterns. Any path we want the Worker to own must match that list.
- The owner cookie is scoped to the session path — a host opening two sessions in the same browser gets two independent cookies.
- Auto spin picks a random track, so a genre's chance equals its share of the catalogue. The console's Boost select counters that: the favoured genre and its chance travel inside the spin POST (`boostGenre`, `boostChance`) and are never written to `RoomState`, which is broadcast to the public display. Only spins sent from the console carry a boost, and a console reload resets it to Off.
- D1 `RANDOM()` is non-deterministic; `pickRandomTrack` uses it and may return different rows on repeated calls with the same `excludeIds`.
- iTunes metadata fields (release date, artwork, preview URL) can be empty or malformed. The importer validates year bounds (1900..current+2) and falls back gracefully.
- iTunes Search throttles ~20 req/min/IP and answers bursts with 429. `fetchItunes` retries on 429/503 with backoff (honouring `Retry-After`); the CLI also paces requests via `--delay` (default 500ms). A still-throttled query surfaces as a per-track `no_preview`, not a Worker 500.
- Free-text import picks the top iTunes match scoring >= 50 (`src/importer/match.ts`); pass `--country RU` so Russian-language queries hit the right storefront.

## Commit prompt

When the user asks for a commit, reply with one line and nothing else:

```
git commit -m "feat(worker): <what and why>"
```

Scopes commonly used here: `worker`, `do`, `web`, `ui`, `assets`, `config`, `tests`, `catalog`, `admin`, `docs`, `deps`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
