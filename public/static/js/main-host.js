// Host bootstrap. Reads the session id from the rewriter-injected meta tag,
// fetches bootstrap state + genres in parallel, opens the SSE stream, and
// wires DOM events through `host-actions`. UI rendering lives in `host-ui`.

import {
  fetchGenres,
  fetchState,
  addTeam,
  removeTeam,
  renameTeam,
  spin,
  play,
  award,
  reveal,
  next,
  endgame,
} from './host-actions.js';
import { render, renderClock } from './host-ui.js';

const sessionId = document.querySelector('meta[name="session-id"]')?.content ?? '';

const TICK_MS = 250;

function teamId() {
  return 't_' + Math.random().toString(36).slice(2, 10);
}

const DO_ERRORS = {
  'no tracks available': 'Нет доступных треков (все жанры пусты или заархивированы)',
  'no current track': 'Нет текущего трека',
  'track not found': 'Трек не найден',
};

function showError(msg) {
  const mapped = DO_ERRORS[msg] ?? msg;
  const el = document.getElementById('error');
  if (el) el.textContent = mapped;
}

if (!sessionId) {
  document.body.textContent = 'no session id';
} else {
  void boot();
}

async function boot() {
  let currentState;
  let genres = [];
  try {
    const [s, g] = await Promise.all([
      fetchState(fetch, sessionId),
      fetchGenres(fetch).catch(() => []),
    ]);
    currentState = s;
    genres = g;
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
    return;
  }

  const view = { state: currentState, genres, sessionId };
  render(document, view);
  wireEvents(view);
  openSse(view);
  // Periodic tick keeps the scrubber + time readout fresh during playback.
  setInterval(() => renderClock(document, view.state), TICK_MS);
}

function wireEvents(view) {
  const addForm = document.getElementById('add-team-form');
  addForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('add-team-input');
    const name = input?.value.trim();
    if (!name) return;
    addTeam(fetch, sessionId, teamId(), name)
      .then(() => { if (input) input.value = ''; })
      .catch((err) => showError(err.message));
  });

  const teamsList = document.getElementById('teams-list');
  teamsList?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.teamId;
    if (!id) return;
    if (btn.dataset.action === 'remove') {
      removeTeam(fetch, sessionId, id).catch((err) => showError(err.message));
    } else if (btn.dataset.action === 'rename') {
      const current = view.state.teams.find((t) => t.id === id)?.name ?? '';
      const next = prompt('Новое название команды', current);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) return;
      renameTeam(fetch, sessionId, id, trimmed).catch((err) => showError(err.message));
    }
  });

  const spinBtn = document.getElementById('spin-btn');
  spinBtn?.addEventListener('click', () => {
    const mode = document.querySelector('input[name="genre-mode"]:checked')?.value;
    const genre = mode === 'pick' ? document.getElementById('genre-select')?.value || null : null;
    spin(fetch, sessionId, genre).catch((err) => showError(err.message));
  });

  const playBtn = document.getElementById('play-btn');
  playBtn?.addEventListener('click', () => {
    play(fetch, sessionId).catch((err) => showError(err.message));
  });

  const replayBtn = document.getElementById('replay-btn');
  replayBtn?.addEventListener('click', () => {
    const audio = document.getElementById('audio');
    if (audio) {
      try { audio.currentTime = 0; } catch { /* not seekable */ }
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  });

  const revealBtn = document.getElementById('reveal-btn');
  revealBtn?.addEventListener('click', () => {
    reveal(fetch, sessionId).catch((err) => showError(err.message));
  });

  const nextBtn = document.getElementById('next-btn');
  nextBtn?.addEventListener('click', () => {
    next(fetch, sessionId).catch((err) => showError(err.message));
  });

  const awardList = document.getElementById('award-teams');
  awardList?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="award"]');
    if (!btn) return;
    const id = btn.dataset.teamId;
    const points = Number(btn.dataset.points);
    if (!id || !(points === 1 || points === 2)) return;
    award(fetch, sessionId, id, points).catch((err) => showError(err.message));
  });

  const endBtn = document.getElementById('endgame-btn');
  endBtn?.addEventListener('click', () => {
    if (!confirm('Завершить игру?')) return;
    const reset = confirm('Сбросить счёт команд?');
    endgame(fetch, sessionId, reset).catch((err) => showError(err.message));
  });

  const modeRadios = document.querySelectorAll('input[name="genre-mode"]');
  for (const r of modeRadios) {
    r.addEventListener('change', () => render(document, view));
  }
}

function openSse(view) {
  const es = new EventSource(`/s/${sessionId}/api/events`);
  es.addEventListener('state', (e) => {
    try {
      view.state = JSON.parse(e.data);
      render(document, view);
    } catch { /* malformed frame, ignore */ }
  });
  // Browser auto-reconnects on transient SSE errors; no explicit handler needed.
}
