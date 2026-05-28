// Host UI render. Idempotent: call render(doc, view) on every state change;
// it patches the DOM in place. Keeps zero local state of its own — every
// frame is computed from `view = { state, genres, sessionId }`.

import { audioCurrentTime } from './audio-sync.js';

const CLIP_DURATION_SEC = 30;

function fmtTime(sec) {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function renderTeams(doc, state) {
  const list = doc.getElementById('teams-list');
  if (!list) return;
  clearChildren(list);
  for (const team of state.teams) {
    const li = doc.createElement('li');
    li.className = 'team';
    li.dataset.teamId = team.id;

    const name = doc.createElement('span');
    name.className = 'team__name';
    name.textContent = team.name;

    const score = doc.createElement('span');
    score.className = 'team__score num';
    score.textContent = String(team.score);

    const rename = doc.createElement('button');
    rename.className = 'btn btn--ghost team__btn';
    rename.type = 'button';
    rename.dataset.action = 'rename';
    rename.dataset.teamId = team.id;
    rename.textContent = 'Переименовать';

    const remove = doc.createElement('button');
    remove.className = 'btn btn--ghost team__btn';
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.dataset.teamId = team.id;
    remove.textContent = 'Удалить';

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
  // Preserve selection across re-renders when possible.
  if (current && genres.some((g) => g.slug === current)) {
    select.value = current;
  }

  // Disable genre controls outside idle to prevent mid-round mutation.
  const idle = state.phase === 'idle';
  const mode = doc.querySelector('input[name="genre-mode"]:checked');
  const pickActive = mode?.value === 'pick';
  select.disabled = !(idle && pickActive);
  for (const radio of doc.querySelectorAll('input[name="genre-mode"]')) {
    radio.disabled = !idle;
  }
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function renderPhaseControls(doc, state, sessionId) {
  const spin = doc.getElementById('spin-btn');
  if (spin) spin.disabled = state.phase !== 'idle';

  const phase = doc.getElementById('phase-controls');
  setHidden(phase, state.phase === 'idle');

  const playBtn = doc.getElementById('play-btn');
  setHidden(playBtn, state.phase !== 'spinning');

  const replayBtn = doc.getElementById('replay-btn');
  setHidden(replayBtn, state.phase !== 'playing' && state.phase !== 'revealed');

  const revealBtn = doc.getElementById('reveal-btn');
  setHidden(revealBtn, state.phase !== 'playing');

  const nextBtn = doc.getElementById('next-btn');
  setHidden(nextBtn, state.phase !== 'revealed' && state.phase !== 'playing');

  const award = doc.getElementById('award-area');
  setHidden(award, state.phase !== 'playing' && state.phase !== 'revealed');
  renderAwardTeams(doc, state);

  const card = doc.getElementById('reveal-card');
  setHidden(card, state.phase !== 'revealed' || state.revealedTrack === null);
  if (card && state.revealedTrack) {
    card.querySelector('.reveal-card__artist').textContent = state.revealedTrack.artist;
    card.querySelector('.reveal-card__title').textContent = state.revealedTrack.title;
    card.querySelector('.reveal-card__year').textContent = String(state.revealedTrack.year);
  }

  const audio = doc.getElementById('audio');
  if (audio) {
    const wantSrc = state.currentTrack
      ? `/s/${sessionId}/api/track/${encodeURIComponent(state.currentTrack.id)}.mp3`
      : '';
    if (audio.getAttribute('src') !== wantSrc) {
      if (wantSrc) audio.setAttribute('src', wantSrc);
      else audio.removeAttribute('src');
    }
    syncAudio(audio, state);
  }
}

function renderAwardTeams(doc, state) {
  const list = doc.getElementById('award-teams');
  if (!list) return;
  clearChildren(list);
  for (const team of state.teams) {
    const li = doc.createElement('li');
    li.className = 'award-list__item';

    const name = doc.createElement('span');
    name.className = 'award-list__name';
    name.textContent = team.name;

    const plus1 = doc.createElement('button');
    plus1.className = 'btn btn--ghost';
    plus1.type = 'button';
    plus1.dataset.action = 'award';
    plus1.dataset.teamId = team.id;
    plus1.dataset.points = '1';
    plus1.textContent = '+1';

    const plus2 = doc.createElement('button');
    plus2.className = 'btn btn--primary';
    plus2.type = 'button';
    plus2.dataset.action = 'award';
    plus2.dataset.teamId = team.id;
    plus2.dataset.points = '2';
    plus2.textContent = '+2';

    li.append(name, plus1, plus2);
    list.append(li);
  }
}

function syncAudio(audio, state) {
  if (state.phase === 'playing' && state.audioStartTimestamp !== null) {
    const wantTime = audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC);
    // Only nudge currentTime when drift is >0.5s to avoid stutter on every render.
    if (Math.abs((audio.currentTime ?? 0) - wantTime) > 0.5) {
      try { audio.currentTime = wantTime; } catch { /* not seekable yet */ }
    }
    if (audio.paused) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture required */ });
    }
  } else if (state.phase === 'spinning' || state.phase === 'idle') {
    if (!audio.paused) audio.pause();
  }
}

function renderMirror(doc, state) {
  const mirror = doc.getElementById('mirror-content');
  if (!mirror) return;
  clearChildren(mirror);

  function appendRow(label, ...children) {
    const p = doc.createElement('p');
    const strong = doc.createElement('strong');
    strong.textContent = label;
    p.append(strong);
    for (const c of children) p.append(c);
    mirror.append(p);
  }

  const phaseSpan = doc.createElement('span');
  phaseSpan.className = 'num';
  phaseSpan.textContent = state.phase;
  appendRow('Фаза:', ' ', phaseSpan);

  appendRow('Жанр:', ` ${state.selectedGenre ?? '—'}`);

  const trackRow = doc.createElement('p');
  const trackStrong = doc.createElement('strong');
  trackStrong.textContent = 'Трек:';
  trackRow.append(trackStrong);
  if (state.currentTrack && state.phase !== 'revealed') {
    trackRow.append(' ?');
  } else if (state.revealedTrack) {
    const t = state.revealedTrack;
    trackRow.append(` ${t.artist} — ${t.title} `);
    const yearSpan = doc.createElement('span');
    yearSpan.className = 'num';
    yearSpan.textContent = `(${t.year})`;
    trackRow.append(yearSpan);
  } else {
    trackRow.append(' —');
  }
  mirror.append(trackRow);

  const playedSpan = doc.createElement('span');
  playedSpan.className = 'num';
  playedSpan.textContent = String(state.playedTrackIds.length);
  appendRow('Сыграно раундов:', ' ', playedSpan);
}

export function renderClock(doc, state) {
  const scrubber = doc.getElementById('scrubber');
  const timeReadout = doc.getElementById('time-readout');
  const cur = audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC);
  if (scrubber) scrubber.value = String(cur);
  if (timeReadout) {
    timeReadout.textContent = `${fmtTime(cur)} / ${fmtTime(CLIP_DURATION_SEC)}`;
  }

  const audio = doc.getElementById('audio');
  if (audio && state.phase === 'playing' && state.audioStartTimestamp !== null) {
    const wantTime = audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC);
    if (Math.abs((audio.currentTime ?? 0) - wantTime) > 0.5) {
      try { audio.currentTime = wantTime; } catch { /* not seekable yet */ }
    }
  }
}

export function render(doc, view) {
  const { state, genres, sessionId } = view;

  const codeEl = doc.getElementById('session-code');
  if (codeEl) codeEl.textContent = sessionId;

  renderTeams(doc, state);
  renderGenres(doc, genres ?? [], state);
  renderPhaseControls(doc, state, sessionId);
  renderMirror(doc, state);
  renderClock(doc, state);
}
