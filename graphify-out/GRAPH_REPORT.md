# Graph Report - guess-the-melody  (2026-08-10)

## Corpus Check
- 87 files · ~80,549 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 678 nodes · 1214 edges · 45 communities (41 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `618f04c3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 42|Community 42]]

## God Nodes (most connected - your core abstractions)
1. `boot()` - 21 edges
2. `Env` - 19 edges
3. `Guess The Melody — Implementation Plan` - 18 edges
4. `handleAdmin()` - 17 edges
5. `MelodyRoom` - 16 edges
6. `Audio Playback Fixes Implementation Plan` - 16 edges
7. `compilerOptions` - 15 edges
8. `postAction()` - 14 edges
9. `Guess The Melody — Design` - 13 edges
10. `getTrack()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `harness()` --calls--> `connectStateStream()`  [EXTRACTED]
  tests/js/sse.test.mjs → public/static/js/sse.js
- `seedTrack()` --calls--> `insertTrack`  [EXTRACTED]
  tests/worker/melody-room.spec.ts → src/catalog/tracks.ts
- `playingAt()` --calls--> `applyAction()`  [EXTRACTED]
  tests/js/logic.test.mjs → public/static/js/logic.js
- `boot()` --calls--> `init()`  [INFERRED]
  public/static/js/main-display.js → public/static/js/main-landing.js
- `playingAt()` --calls--> `initialState()`  [EXTRACTED]
  tests/js/logic.test.mjs → public/static/js/state.js

## Import Cycles
- None detected.

## Communities (45 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (45): audioCurrentTime(), buildSpinCadence(), clearChildren(), fmtTime(), genreName(), isClipEnded(), render(), renderClock() (+37 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (60): createGenre(), deleteGenre(), deleteSession(), deleteTrack(), getGenres(), getSessions(), getStats(), getTracks() (+52 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (49): handleAdmin(), handleAudioContentTypeBackfill(), handleConsoleAction(), handleConsolePage(), handleGenreBySlug(), handleGenresIndex(), handleImport(), handleSessionById() (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (30): ImportError, ImportSuccess, isUniqueConstraintError(), itunesToResolved(), ResolvedTrack, ResolveResult, resolveTrack(), fetchItunes() (+22 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (28): resolveRange(), ServeAudioOpts, serveR2Audio(), randomUrlSafe(), fetch(), generateQrSvg(), handleQr(), clientIp() (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (17): applyAction(), expectPhase(), VALID_TRANSITIONS, addTeam(), awardPoints(), initialState(), removeTeam(), renameTeam() (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (28): Apple Human Interface Guidelines, Architecture, Assets, Auth, Clean code, Cloudflare guidance, Commit prompt, Compatibility date (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (29): Admin UI (`/admin`), Animation stack, Audio sync, Auth and session management, CLI, D1 schema, Data, Directory structure (+21 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (23): dependencies, qrcode-svg, devDependencies, @cloudflare/vitest-pool-workers, @cloudflare/workers-types, happy-dom, @types/bun, @types/qrcode-svg (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (22): ClassifiedLine, classifyLine(), CliArgs, COLOR, describeResult(), formatLogLine(), formatStats(), ImportFailure (+14 more)

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (12): answerText(), clearChildren(), render(), renderGenres(), renderPlayButton(), renderScoreboard(), setHidden(), setText() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (17): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, isolatedModules, lib, module, moduleResolution, noEmit (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (16): Audio Playback Fixes Implementation Plan, Task 10: Expose AudioContext suspension from the waveform controller, Task 12: Overlay markup and styles, Task 13: Move playback ownership out of syncAudioDisplay, Task 14: Wire the sound gate into the display bootstrap, Task 15: Delete the dead host page, Task 16: Full verification and rollout, Task 1: Shared R2 audio serving helper (stored Content-Type, ETag, Accept-Ranges) (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (9): deleteSessionsOlderThan(), SessionRow, SessionSnapshot, TrackAnswer, upsertSession(), scheduled(), Env, testEnv (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (14): Bash-output gotcha observed this session, Catalogue lists — current state (`lists/`), Conventions (unchanged), Curation lessons (so they're not repeated), D1 database, Goal (active task), Handoff — Guess The Melody, How to read the catalogue years (three options) (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.24
Nodes (5): detectAudioContentType(), FTYP, deletePreviewFromR2(), downloadPreviewToR2(), testEnv

### Community 16 - "Community 16"
Cohesion: 0.20
Nodes (7): ChunkReader, clearAudio(), createSession(), parseOwnerFromSetCookie(), resetCatalog(), SessionCreated, testEnv

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (10): Cross-cutting reminders for the executor, Deferred (not MVP), Guess The Melody — Implementation Plan, Phase 13 — QR code, Phase 15 — `CLAUDE.md` and `README.md`, Phase 6 — Catalogue (D1 access layer), Phase 9 — Landing page, Task 6.1: `src/catalog/genres.ts` (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (9): Phase 1 — Project bootstrap, Task 1.1: Create `package.json`, Task 1.2: Create `.gitignore`, Task 1.3: Create `tsconfig.json` (src only), Task 1.4: Create `tsconfig.test.json`, Task 1.5: Create `wrangler.toml`, Task 1.6: Create `vitest.config.ts`, Task 1.7: Create empty `public/index.html` placeholder (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.22
Nodes (3): itunesTrackJson, Route, testEnv

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (7): Deploy, Guess The Melody, Import tracks, Project docs, Run locally, Tech, What it is

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (4): insertTrack, ChunkReader, seedTrack(), testEnv

### Community 23 - "Community 23"
Cohesion: 0.29
Nodes (7): Phase 7 — Importer, Task 7.1: `src/importer/itunes.ts` — search + lookup, Task 7.2: `src/importer/spotify.ts` — oEmbed parse + iTunes match, Task 7.3: `src/importer/r2.ts` — download + put, Task 7.4: `src/importer/import-track.ts` — orchestration, Task 7.5: `src/admin/handlers.ts` — admin endpoints, Task 7.6: `src/cli/import.ts` — CLI

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (6): compilerOptions, lib, types, exclude, extends, include

### Community 26 - "Community 26"
Cohesion: 0.33
Nodes (6): Phase 11 — Display UI (the jukebox), Task 11.1: `public/display.html` shell, Task 11.2: `display.css` — scene layout, Task 11.3: `jukebox.js` — arm + spin animation, Task 11.4: `waveform.js` — circular analyser, Task 11.5: `display-ui.js` and `main-display.js`

### Community 28 - "Community 28"
Cohesion: 0.40
Nodes (5): Phase 10 — Host (judge) UI, Task 10.1: `public/host.html` shell, Task 10.2: `public/static/js/host-ui.js`, Task 10.3: `public/static/js/main-host.js`, Task 10.4: CSS — `host.css`

### Community 29 - "Community 29"
Cohesion: 0.40
Nodes (5): Phase 2 — D1 schema, Task 2.1: Create D1 database, Task 2.2: Write `0001_init.sql`, Task 2.3: Write `0002_seed_genres.sql`, Task 2.4: Apply migrations locally

### Community 30 - "Community 30"
Cohesion: 0.40
Nodes (5): Phase 3 — Pure logic (TDD), Task 3.1: `prng.js` — mulberry32, Task 3.2: `state.js` — initial state + mutator helpers, Task 3.3: `logic.js` — state machine transitions, Task 3.4: `audio-sync.js` — compute audio currentTime

### Community 31 - "Community 31"
Cohesion: 0.40
Nodes (5): Phase 4 — Worker scaffolding, Task 4.1: `src/types.ts`, Task 4.2: `src/session.ts` — session id + owner token, Task 4.3: `src/auth.ts` — basic-auth for admin, Task 4.4: `src/index.ts` — bare Worker entry

### Community 32 - "Community 32"
Cohesion: 0.40
Nodes (5): Phase 5 — Durable Object: MelodyRoom, Task 5.1: Extract `MelodyRoom` into `src/melody-room.ts`, Task 5.2: DO holds state and snapshots to storage, Task 5.3: SSE fan-out, Task 5.4: Reset action

### Community 33 - "Community 33"
Cohesion: 0.40
Nodes (4): CurrentTrack, Phase, RevealedTrack, Team

### Community 34 - "Community 34"
Cohesion: 0.40
Nodes (4): compilerOptions, types, extends, include

### Community 35 - "Community 35"
Cohesion: 0.50
Nodes (4): Phase 12 — Admin UI, Task 12.1: `public/admin.html`, Task 12.2: `main-admin.js`, Task 12.3: `admin.css`

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (3): Phase 14 — Staging env and deploy, Task 14.1: Provision staging, Task 14.2: Deploy

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): Phase 8 — Worker routing, Task 8.1: `src/router.ts` — wire everything, Task 8.2: Rate-limit `POST /api/session`

## Knowledge Gaps
- **246 isolated node(s):** `name`, `private`, `type`, `dev`, `deploy` (+241 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Env` connect `Community 13` to `Community 33`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 15`, `Community 16`, `Community 19`, `Community 21`, `Community 22`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `Guess The Melody — Implementation Plan` connect `Community 17` to `Community 32`, `Community 35`, `Community 38`, `Community 39`, `Community 18`, `Community 23`, `Community 26`, `Community 28`, `Community 29`, `Community 30`, `Community 31`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _246 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06946386946386947 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08499743983614952 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07782898105478751 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.08776595744680851 - nodes in this community are weakly interconnected._