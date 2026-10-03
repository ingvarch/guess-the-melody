// Display UI renderer. Now drives the full gameplay control surface:
// scoreboard, teams panel, phase-driven controls (spin/play/reveal/next),
// audio sync, award buttons inline on scoreboard cards, and reveal overlay.
// Pure DOM — testable with happy-dom.

import { mulberry32 } from './prng.js';
import { audioCurrentTime, formatClock } from './audio-sync.js';

const CLIP_DURATION_SEC = 30;

// The clip outlives the reveal: revealing mid-play must not cut the music.
function hasClip(state) {
  return (state.phase === 'playing' || state.phase === 'revealed')
    && state.audioStartTimestamp !== null;
}

function isClipEnded(state) {
  if (!hasClip(state)) return false;
  return audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC, state.audioPausedTimestamp) >= CLIP_DURATION_SEC;
}

// True while the shared state says the clip must be audible on this screen.
// The sound gate polls this every tick; starting playback lives there, not in
// the renderer, because play() needs autoplay-policy handling and retries.
export function shouldBeAudible(state) {
  return hasClip(state)
    && state.audioPausedTimestamp == null
    && !isClipEnded(state);
}

const TEAM_ICONS = ['rocket_launch', 'electric_bolt', 'auto_awesome', 'texture', 'bolt', 'flare', 'whatshot', 'star'];
const TEAM_COLORS = [
  { text: 'text-secondary', bar: 'bg-secondary glow-track-fill' },
  { text: 'text-tertiary',  bar: 'bg-tertiary' },
  { text: 'text-primary',   bar: 'bg-primary' },
  { text: 'text-on-surface-variant', bar: 'bg-on-surface-variant/40' },
];

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function fmtScore(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function renderScoreboard(doc, state) {
  const list = doc.getElementById('scoreboard-list');
  if (!list) return;
  clearChildren(list);

  const showAward = state.phase === 'playing' || state.phase === 'revealed';
  const maxScore = state.teams.reduce((acc, t) => Math.max(acc, t.score), 0) || 1;

  state.teams.forEach((team, i) => {
    const palette = TEAM_COLORS[i % TEAM_COLORS.length];
    const icon = TEAM_ICONS[i % TEAM_ICONS.length];
    const pct = Math.max(4, Math.round((team.score / maxScore) * 100));

    const li = doc.createElement('li');
    li.className = 'scoreboard__item space-y-4';
    li.dataset.teamId = team.id;

    const headerRow = doc.createElement('div');
    headerRow.className = 'flex justify-between items-end';

    const labelGroup = doc.createElement('div');
    labelGroup.className = 'flex items-center space-x-3';

    const iconEl = doc.createElement('span');
    iconEl.className = `material-symbols-outlined ${palette.text}`;
    iconEl.setAttribute('style', "font-variation-settings: 'FILL' 1;");
    iconEl.textContent = icon;

    const nameEl = doc.createElement('span');
    nameEl.className = 'scoreboard__name font-label-mono text-label-mono text-on-surface uppercase tracking-wider';
    nameEl.textContent = team.name;

    labelGroup.append(iconEl, nameEl);

    const scoreEl = doc.createElement('span');
    scoreEl.className = `scoreboard__score num font-headline-lg text-headline-lg ${palette.text}`;
    scoreEl.textContent = fmtScore(team.score);

    headerRow.append(labelGroup, scoreEl);

    const meter = doc.createElement('div');
    meter.className = 'h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden';
    const meterFill = doc.createElement('div');
    meterFill.className = `h-full ${palette.bar} rounded-full`;
    meterFill.setAttribute('style', `width: ${pct}%`);
    meter.append(meterFill);

    li.append(headerRow, meter);

    if (showAward) {
      const actions = doc.createElement('div');
      actions.className = 'flex gap-2 pt-1';

      const plus1 = doc.createElement('button');
      plus1.type = 'button';
      plus1.className = 'flex-1 py-1.5 rounded bg-secondary/10 text-secondary border border-secondary/20 hover:bg-secondary hover:text-on-secondary transition-all font-bold font-label-mono text-label-mono';
      plus1.dataset.action = 'award';
      plus1.dataset.teamId = team.id;
      plus1.dataset.points = '1';
      plus1.textContent = '+1';

      const plus2 = doc.createElement('button');
      plus2.type = 'button';
      plus2.className = 'flex-1 py-1.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-on-primary transition-all font-bold font-label-mono text-label-mono';
      plus2.dataset.action = 'award';
      plus2.dataset.teamId = team.id;
      plus2.dataset.points = '2';
      plus2.textContent = '+2';

      actions.append(plus1, plus2);
      li.append(actions);
    }

    list.append(li);
  });
}

function renderTeamsList(doc, state) {
  const list = doc.getElementById('teams-list');
  if (!list) return;
  clearChildren(list);
  for (const team of state.teams) {
    const li = doc.createElement('li');
    li.className = 'team flex items-center justify-between gap-2 bg-surface-container-low/50 rounded-lg px-3 py-2';
    li.dataset.teamId = team.id;

    const name = doc.createElement('span');
    name.className = 'team__name flex-1 font-body-md text-body-md text-on-surface truncate';
    name.textContent = team.name;

    const score = doc.createElement('span');
    score.className = 'team__score num font-label-mono text-label-mono text-on-surface-variant';
    score.textContent = String(team.score);

    const rename = doc.createElement('button');
    rename.className = 'team__btn material-symbols-outlined text-on-surface-variant hover:text-primary text-[18px]';
    rename.type = 'button';
    rename.dataset.action = 'rename';
    rename.dataset.teamId = team.id;
    rename.title = 'Rename';
    rename.textContent = 'edit';

    const remove = doc.createElement('button');
    remove.className = 'team__btn material-symbols-outlined text-on-surface-variant hover:text-error text-[18px]';
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.dataset.teamId = team.id;
    remove.title = 'Remove';
    remove.textContent = 'delete';

    li.append(name, score, rename, remove);
    list.append(li);
  }
}

function renderGenres(doc, genres, state) {
  const select = doc.getElementById('genre-select');
  if (!select) return;
  const current = select.value;
  clearChildren(select);
  // First option = auto spin (empty value). Empty means "no genre" so the
  // server picks one at random; any other value is a host-chosen genre.
  const auto = doc.createElement('option');
  auto.value = '';
  auto.textContent = 'Surprise me (Auto)';
  select.append(auto);
  for (const g of genres) {
    const opt = doc.createElement('option');
    opt.value = g.slug;
    opt.textContent = g.name;
    select.append(opt);
  }
  if (current && genres.some((g) => g.slug === current)) {
    select.value = current;
  }
  select.disabled = state.phase !== 'idle';
}

// Time-aware control gating. Drives the launch workflow:
//   spinning  -> PLAY appears (start the clip)
//   playing   -> only the visualiser; once the 30s clip ends, REVEAL + REPEAT
//   revealed  -> NEXT  (REPEAT is unavailable: the `replay` transition in
//                logic.js is only valid from `playing`)
// Re-evaluated on every clock tick (not just state changes) so the clip-end
// transition surfaces the buttons without waiting for a server message.
export function renderPlaybackControls(doc, state) {
  const idle = state.phase === 'idle';
  const playing = state.phase === 'playing';
  const revealed = state.phase === 'revealed';
  const ended = isClipEnded(state);
  const paused = state.audioPausedTimestamp != null;

  setHidden(doc.getElementById('idle-controls'), !idle);

  const spin = doc.getElementById('spin-btn');
  if (spin) spin.disabled = !idle;

  setHidden(doc.getElementById('phase-controls'), idle);

  // The play button doubles as a pause/resume toggle once the clip is running:
  //   spinning            -> Play (start the clip)
  //   playing, running    -> Pause
  //   playing, paused     -> Play (resume)
  //   playing, ended      -> hidden (Reveal/Replay take over)
  const playBtn = doc.getElementById('play-btn');
  const showPlayBtn = state.phase === 'spinning' || (playing && !ended);
  setHidden(playBtn, !showPlayBtn);
  if (playBtn) {
    const showPause = playing && !paused && !ended;
    const icon = playBtn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = showPause ? 'pause' : 'play_arrow';
    playBtn.setAttribute('aria-label', showPause ? 'Pause' : 'Play');
  }

  // Replay and Reveal share the same decision points: the clip ran out, or
  // the host paused (someone guessed early / wants to start the clip over).
  setHidden(doc.getElementById('replay-btn'), !(playing && (ended || paused)));
  setHidden(doc.getElementById('reveal-btn'), !(playing && (ended || paused)));
  setHidden(doc.getElementById('next-btn'), !revealed);

  // The scrubber accepts input for the whole playing phase (paused and
  // time's-up included), so the host can jump anywhere inside the clip.
  const scrubber = doc.getElementById('scrubber');
  if (scrubber) scrubber.disabled = !playing;
}

// Failed host actions used to be swallowed (403s silently, everything else to
// console.warn), so a display without the session's owner cookie looked alive
// while every control did nothing. Say so instead.
export function showActionError(doc, err) {
  const el = doc.getElementById('action-error');
  if (!el) return;
  const msg = err instanceof Error ? err.message : String(err);
  el.textContent = /\b403\b/.test(msg)
    ? 'Read-only view — run the game from the host console'
    : msg;
  el.removeAttribute('hidden');
}

export function clearActionError(doc) {
  doc.getElementById('action-error')?.setAttribute('hidden', '');
}

function genreName(genres, slug) {
  if (!slug) return '—';
  return genres.find((g) => g.slug === slug)?.name ?? slug;
}

function renderPhaseLabel(doc, state, genres) {
  const label = doc.getElementById('phase-label');
  const genre = doc.getElementById('display-genre');
  if (!label || !genre) return;
  if (state.phase === 'idle') {
    label.textContent = 'READY';
    genre.textContent = 'Press SPIN to start';
  } else if (state.phase === 'spinning') {
    label.textContent = `ROUND ${state.playedTrackIds.length + 1}`;
    genre.textContent = state.genrePicked ? genreName(genres, state.selectedGenre) : 'Picking Genre...';
  } else if (state.phase === 'playing') {
    label.textContent = isClipEnded(state) ? "TIME'S UP" : 'NOW PLAYING';
    genre.textContent = genreName(genres, state.selectedGenre);
  } else if (state.phase === 'revealed') {
    label.textContent = 'REVEAL';
    genre.textContent = genreName(genres, state.selectedGenre);
  }
}

function syncAudioDisplay(doc, state, sessionId) {
  const audio = doc.getElementById('audio');
  if (!audio) return;

  const wantSrc = state.currentTrack
    ? `/s/${sessionId}/api/track/${encodeURIComponent(state.currentTrack.id)}.mp3`
    : '';
  if (audio.getAttribute('src') !== wantSrc) {
    if (wantSrc) audio.setAttribute('src', wantSrc);
    else audio.removeAttribute('src');
  }

  const isPaused = state.audioPausedTimestamp != null;
  if (hasClip(state) && !isPaused) {
    const wantTime = audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC);
    if (Math.abs((audio.currentTime ?? 0) - wantTime) > 0.5) {
      try { audio.currentTime = wantTime; } catch { /* not seekable yet */ }
    }
  } else {
    // No clip, or explicitly paused: stop playback. A paused clip holds
    // its position so resume continues from the same spot.
    if (!audio.paused) audio.pause();
  }
}

function renderRevealCard(doc, state) {
  const card = doc.getElementById('reveal-card');
  if (!card) return;
  const show = state.phase === 'revealed' && state.revealedTrack !== null;
  setHidden(card, !show);
  if (show) {
    card.querySelector('.reveal-card__artist').textContent = state.revealedTrack.artist;
    card.querySelector('.reveal-card__title').textContent = state.revealedTrack.title;
    card.querySelector('.reveal-card__year').textContent = String(state.revealedTrack.year);
  }
}

export function renderClock(doc, state) {
  const scrubber = doc.getElementById('scrubber');
  const timeReadout = doc.getElementById('time-readout');
  const cur = audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC, state.audioPausedTimestamp);
  // Mid-drag the thumb belongs to the user's finger, not the clock.
  if (scrubber && scrubber.dataset.scrubbing === undefined) scrubber.value = String(cur);
  if (timeReadout) {
    timeReadout.textContent = `${formatClock(cur)} / ${formatClock(CLIP_DURATION_SEC)}`;
  }

  const audio = doc.getElementById('audio');
  if (audio && hasClip(state)) {
    const wantTime = audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC, state.audioPausedTimestamp);
    if (Math.abs((audio.currentTime ?? 0) - wantTime) > 0.5) {
      try { audio.currentTime = wantTime; } catch { /* not seekable yet */ }
    }
  }
}

export function render(doc, view) {
  const { state, genres, sessionId } = view;

  const codeEl = doc.getElementById('session-code');
  if (codeEl) codeEl.textContent = sessionId;

  renderPhaseLabel(doc, state, genres ?? []);
  renderScoreboard(doc, state);
  renderTeamsList(doc, state);
  renderGenres(doc, genres ?? [], state);
  renderPlaybackControls(doc, state);
  renderRevealCard(doc, state);

  syncAudioDisplay(doc, state, sessionId);
  renderClock(doc, state);
}

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// "Picking genre" slot-machine: cycle genre names on the headline, decelerating
// to a stop on the chosen one. Deterministic given spinSeed so every viewer
// (display + spectators) lands on the same sequence. Resolves with the headline
// showing the selected genre's display name.
// Builds the spin cadence as fractions of the total spin time: a long burst of
// equal fast flips, then a decelerating tail whose steps grow super-linearly so
// it visibly eases to a stop. Tuned for ~2s fast + ~6s slowing at durationMs=8000.
function buildSpinCadence() {
  const FAST_FLIPS = 32;
  const SLOW_FLIPS = 16;
  const fastBudget = 0.25; // share of total spent flipping fast
  const slowBudget = 1 - fastBudget;
  const fast = Array.from({ length: FAST_FLIPS }, () => fastBudget / FAST_FLIPS);
  const weights = Array.from({ length: SLOW_FLIPS }, (_, i) => (i + 1) ** 1.7);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const slow = weights.map((w) => (slowBudget * w) / wsum);
  return [...fast, ...slow];
}

export async function runSpin(doc, state, genres, { durationMs = 8000, settleMs = 3000, confirmMs = 1000, getPhase } = {}) {
  const overlay = doc.getElementById('spin-card');
  const spinText = doc.getElementById('spin-card-genre');
  const headline = doc.getElementById('display-genre');
  if (!spinText || state.phase !== 'spinning' || genres.length === 0) return;

  const selected = genres.find((g) => g.slug === state.selectedGenre);
  const finalName = selected?.name ?? state.selectedGenre ?? '—';

  // The captured `state` is replaced wholesale on each SSE frame, so check the
  // live phase via getPhase: if the round advances to playing mid-spin, bail.
  const stillSpinning = () => (getPhase ? getPhase() === 'spinning' : true);
  const close = () => {
    overlay?.classList.remove('spin-card--confirm');
    setHidden(overlay, true);
  };

  setHidden(overlay, false);

  // Host chose the genre: cycling through names reveals nothing. Show the chosen
  // genre with a brief pop instead of a fake random draw.
  if (state.genrePicked) {
    if (!stillSpinning()) { close(); return; }
    spinText.textContent = finalName;
    if (headline) headline.textContent = finalName;
    overlay?.classList.add('spin-card--confirm');
    await wait(confirmMs);
    close();
    return;
  }

  const prng = mulberry32(state.spinSeed || 1);
  // Cadence = fractions of durationMs. ~2s of rapid flips up front, then a long
  // (~5-6s) deceleration easing to a stop on the chosen genre.
  const cadence = buildSpinCadence();
  let prevIdx = -1;
  for (const frac of cadence) {
    if (!stillSpinning()) { close(); return; }
    let idx;
    do { idx = Math.floor(prng() * genres.length); }
    while (idx === prevIdx && genres.length > 1);
    prevIdx = idx;
    spinText.textContent = genres[idx].name;
    await wait(Math.max(16, Math.round(frac * durationMs)));
  }
  if (!stillSpinning()) { close(); return; }

  // Land on the chosen genre — in the card and on the underlying headline, so
  // the normal spinning screen shows it once the overlay closes.
  spinText.textContent = finalName;
  if (headline) headline.textContent = finalName;

  // Hold briefly so players read the genre, then drop back to the Play screen.
  await wait(settleMs);
  close();
}
