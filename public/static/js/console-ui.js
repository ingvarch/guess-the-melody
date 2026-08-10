// Admin host-console renderer. Pure DOM — no fetch, no globals. The console is
// a private monitor (basic-auth gated): it shows the current track's answer so
// the host can judge guesses, mirrors the live scoreboard, animates a "playing"
// bar effect, and drives the full round — genre pick + Spin, a Play/Stop
// (pause/resume) toggle, Reveal, and Next — so a phone can run the game alone.

import { audioCurrentTime, formatClock } from './audio-sync.js';

const CLIP_DURATION_SEC = 30;

function setText(doc, id, value) {
  const el = doc.getElementById(id);
  if (el) el.textContent = value;
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function answerText(answer) {
  if (!answer) return '—';
  const { artist, title, year } = answer;
  return `${artist} — ${title}${year ? ` (${year})` : ''}`;
}

function renderGenres(doc, genres, state) {
  const select = doc.getElementById('genre-select');
  if (!select) return;
  const current = select.value;
  while (select.firstChild) select.removeChild(select.firstChild);
  // Empty value = auto: the server picks a genre at random.
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
  if (current && genres.some((g) => g.slug === current)) select.value = current;
  select.disabled = state.phase !== 'idle';
}

// Play button doubles as a stop (pause) / resume toggle once a clip runs:
//   spinning         -> Play  (start the clip)
//   playing, running -> Stop  (pause, holds position)
//   playing, paused  -> Play  (resume from the same spot)
// The resolved DO action is stamped on dataset.action so the bootstrap handler
// stays dumb. Outside these phases the button is hidden.
function renderPlayButton(doc, state) {
  const btn = doc.getElementById('play-btn');
  if (!btn) return;
  const spinning = state.phase === 'spinning';
  const playing = state.phase === 'playing';
  setHidden(btn, !(spinning || playing));
  if (!spinning && !playing) return;

  const paused = state.audioPausedTimestamp != null;
  const action = spinning ? 'play' : paused ? 'resume' : 'pause';
  const stop = playing && !paused;
  btn.dataset.action = action;
  const icon = btn.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = stop ? 'stop' : 'play_arrow';
  const label = btn.querySelector('.play-btn__label');
  if (label) label.textContent = stop ? 'STOP' : 'PLAY';
}

function renderScoreboard(doc, teams) {
  const list = doc.getElementById('console-scoreboard');
  if (!list) return;
  clearChildren(list);
  const sorted = teams.slice().sort((a, b) => b.score - a.score);
  for (const team of sorted) {
    const li = doc.createElement('li');
    li.className = 'team flex items-center justify-between gap-3 bg-surface-container-low/50 rounded-lg px-4 py-3';
    const name = doc.createElement('span');
    name.className = 'team__name font-body-md text-body-md text-on-surface truncate';
    name.textContent = team.name;
    const score = doc.createElement('span');
    score.className = 'team__score num font-headline-lg text-headline-lg-mobile text-secondary';
    score.textContent = String(team.score);
    li.append(name, score);
    list.append(li);
  }
}

// Seek bar. This is the host's authoritative playback control: the console is
// password-gated, so it works from any device, unlike the display's copy which
// needs the session's owner cookie.
function renderSeekRow(doc, state) {
  const playing = state.phase === 'playing';
  const hasClip = state.audioStartTimestamp != null;
  setHidden(doc.getElementById('seek-row'), !(playing || (hasClip && state.phase === 'revealed')));
  const scrubber = doc.getElementById('scrubber');
  if (scrubber) scrubber.disabled = !playing;
}

// Position readout, refreshed on a tick (not just on state frames) so the bar
// advances smoothly between SSE messages.
export function renderClock(doc, state) {
  const scrubber = doc.getElementById('scrubber');
  const cur = audioCurrentTime(
    Date.now(),
    state.audioStartTimestamp ?? null,
    CLIP_DURATION_SEC,
    state.audioPausedTimestamp,
  );
  // Mid-drag the thumb belongs to the host's finger, not the clock.
  if (scrubber && scrubber.dataset.scrubbing === undefined) scrubber.value = String(cur);
  setText(doc, 'time-readout', `${formatClock(cur)} / ${formatClock(CLIP_DURATION_SEC)}`);
}

export function render(doc, { state, answer, genres = [] }) {
  setText(doc, 'console-phase', state.phase);
  setText(doc, 'console-genre', state.selectedGenre ?? '—');
  setText(doc, 'console-track', answerText(answer));
  setText(doc, 'console-rounds', String(state.playedTrackIds?.length ?? 0));

  renderScoreboard(doc, state.teams ?? []);
  renderGenres(doc, genres, state);

  const bars = doc.getElementById('console-bars');
  if (bars) bars.classList.toggle('is-playing', state.phase === 'playing');

  // Spin/genre at idle; Play/Stop toggle drives the clip; Reveal mid-round; Next
  // once revealed. The DO is the final guard on every transition's validity.
  setHidden(doc.getElementById('idle-controls'), state.phase !== 'idle');
  renderPlayButton(doc, state);
  // `replay` is only a valid transition from `playing`, so the restart control
  // lives and dies with the running clip.
  setHidden(doc.getElementById('replay-btn'), state.phase !== 'playing');
  renderSeekRow(doc, state);
  renderClock(doc, state);
  setHidden(doc.getElementById('reveal-btn'), state.phase !== 'playing');
  setHidden(doc.getElementById('next-btn'), state.phase !== 'revealed');
}
