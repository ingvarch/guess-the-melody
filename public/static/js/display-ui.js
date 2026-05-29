// Display UI renderer. Now drives the full gameplay control surface:
// scoreboard, teams panel, phase-driven controls (spin/play/reveal/next),
// audio sync, award buttons inline on scoreboard cards, and reveal overlay.
// Pure DOM — testable with happy-dom.

import { mulberry32 } from './prng.js';
import { audioCurrentTime } from './audio-sync.js';

const CLIP_DURATION_SEC = 30;

function isClipEnded(state) {
  if (state.phase !== 'playing' || state.audioStartTimestamp === null) return false;
  return audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC, state.audioPausedTimestamp) >= CLIP_DURATION_SEC;
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

function fmtTime(sec) {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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
  if (genres.length === 0) {
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '—';
    placeholder.disabled = true;
    select.append(placeholder);
  }
  for (const g of genres) {
    const opt = doc.createElement('option');
    opt.value = g.slug;
    opt.textContent = g.name;
    select.append(opt);
  }
  if (current && genres.some((g) => g.slug === current)) {
    select.value = current;
  }

  const idle = state.phase === 'idle';
  const mode = doc.querySelector('input[name="genre-mode"]:checked');
  const pickActive = mode?.value === 'pick';
  select.disabled = !(idle && pickActive);
  for (const radio of doc.querySelectorAll('input[name="genre-mode"]')) {
    radio.disabled = !idle;
  }
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

  setHidden(doc.getElementById('replay-btn'), !(playing && ended));
  // Reveal becomes available at the clip's end OR as soon as the host pauses —
  // someone guessed early, no reason to wait out the 30s.
  setHidden(doc.getElementById('reveal-btn'), !(playing && (ended || paused)));
  setHidden(doc.getElementById('next-btn'), !revealed);
  setHidden(doc.getElementById('current-track'), !state.currentTrack || idle);
}

function renderPhaseLabel(doc, state) {
  const label = doc.getElementById('phase-label');
  const genre = doc.getElementById('display-genre');
  if (!label || !genre) return;
  if (state.phase === 'idle') {
    label.textContent = 'READY';
    genre.textContent = 'Press SPIN to start';
  } else if (state.phase === 'spinning') {
    label.textContent = `ROUND ${state.playedTrackIds.length + 1}`;
    genre.textContent = 'Picking Genre...';
  } else if (state.phase === 'playing') {
    label.textContent = isClipEnded(state) ? "TIME'S UP" : 'NOW PLAYING';
    genre.textContent = state.selectedGenre ?? '—';
  } else if (state.phase === 'revealed') {
    label.textContent = 'REVEAL';
    genre.textContent = state.selectedGenre ?? '—';
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
  if (state.phase === 'playing' && state.audioStartTimestamp !== null && !isPaused) {
    const wantTime = audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC);
    if (Math.abs((audio.currentTime ?? 0) - wantTime) > 0.5) {
      try { audio.currentTime = wantTime; } catch { /* not seekable yet */ }
    }
    if (audio.paused) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture required */ });
    }
  } else {
    // Idle, revealed, or explicitly paused: stop playback. A paused clip holds
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
  if (scrubber) scrubber.value = String(cur);
  if (timeReadout) {
    timeReadout.textContent = `${fmtTime(cur)} / ${fmtTime(CLIP_DURATION_SEC)}`;
  }

  const audio = doc.getElementById('audio');
  if (audio && state.phase === 'playing' && state.audioStartTimestamp !== null) {
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

  renderPhaseLabel(doc, state);
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
export async function runSpin(doc, state, genres, { durationMs = 3200, getPhase } = {}) {
  const headline = doc.getElementById('display-genre');
  if (!headline || state.phase !== 'spinning' || genres.length === 0) return;

  const selected = genres.find((g) => g.slug === state.selectedGenre);
  const finalName = selected?.name ?? state.selectedGenre ?? '—';

  // The captured `state` is replaced wholesale on each SSE frame, so check the
  // live phase via getPhase: if the round advances to playing mid-spin, bail so
  // we stop fighting renderPhaseLabel (which has set the real genre headline).
  const stillSpinning = () => (getPhase ? getPhase() === 'spinning' : true);

  const prng = mulberry32(state.spinSeed || 1);
  // Accelerate-then-decelerate cadence; each entry is a fraction of durationMs.
  const cadence = [0.04, 0.04, 0.05, 0.06, 0.07, 0.09, 0.11, 0.14, 0.18, 0.22];
  let prevIdx = -1;
  for (const frac of cadence) {
    if (!stillSpinning()) return;
    let idx;
    do { idx = Math.floor(prng() * genres.length); }
    while (idx === prevIdx && genres.length > 1);
    prevIdx = idx;
    headline.textContent = genres[idx].name;
    await wait(Math.max(16, Math.round(frac * durationMs)));
  }
  if (!stillSpinning()) return;
  headline.textContent = finalName;
}
