// Display UI renderer. Phase-driven transitions for the jukebox scene.
// Pure DOM — testable with happy-dom.

import { buildShelves, runSpinAnimation } from './jukebox.js';
import { audioCurrentTime } from './audio-sync.js';

const CLIP_DURATION_SEC = 30;

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function renderScoreboard(doc, teams) {
  const list = doc.getElementById('scoreboard-list');
  if (!list) return;
  clearChildren(list);
  for (const team of teams) {
    const li = doc.createElement('li');
    li.className = 'scoreboard__item';

    const name = doc.createElement('span');
    name.className = 'scoreboard__name';
    name.textContent = team.name;

    const score = doc.createElement('span');
    score.className = 'scoreboard__score num';
    score.textContent = String(team.score);

    li.append(name, score);
    list.append(li);
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

  if (state.phase === 'playing' && state.audioStartTimestamp !== null) {
    const wantTime = audioCurrentTime(Date.now(), state.audioStartTimestamp, CLIP_DURATION_SEC);
    if (Math.abs((audio.currentTime ?? 0) - wantTime) > 0.5) {
      try { audio.currentTime = wantTime; } catch { /* not seekable yet */ }
    }
    if (audio.paused) {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture required */ });
    }
  } else {
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

export function render(doc, view) {
  const { state, genres, sessionId } = view;

  renderScoreboard(doc, state.teams);

  // Build shelves once when genres arrive; they persist across phases.
  const shelvesRoot = doc.getElementById('shelves');
  if (shelvesRoot && shelvesRoot.children.length === 0 && genres.length > 0) {
    buildShelves(doc, genres);
  }

  // Disc spin state.
  const disc = doc.getElementById('disc');
  if (disc) {
    disc.classList.toggle('spinning', state.phase === 'playing');
  }

  syncAudioDisplay(doc, state, sessionId);
  renderRevealCard(doc, state);
}

export async function runSpin(doc, state, genres) {
  if (state.phase === 'spinning' && state.spinSeed > 0) {
    await runSpinAnimation({
      doc,
      genres,
      selectedGenre: state.selectedGenre,
      spinSeed: state.spinSeed,
    });
  }
}
