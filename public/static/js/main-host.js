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
  replay,
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
  'no tracks available': 'No tracks available (all genres are empty or archived)',
  'no current track': 'No current track',
  'track not found': 'Track not found',
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
      const next = prompt('New team name', current);
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
    // Server re-stamp so display + spectators restart the clip in sync.
    replay(fetch, sessionId).catch((err) => showError(err.message));
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
    if (!confirm('End the game?')) return;
    const reset = confirm('Reset team scores?');
    endgame(fetch, sessionId, reset).catch((err) => showError(err.message));
  });

  const modeRadios = document.querySelectorAll('input[name="genre-mode"]');
  for (const r of modeRadios) {
    r.addEventListener('change', () => render(document, view));
  }

  // QR modal.
  const qrBtn = document.getElementById('qr-btn');
  const qrModal = document.getElementById('qr-modal');
  const qrImg = document.getElementById('qr-img');
  const qrUrl = document.getElementById('qr-url');
  const qrCopy = document.getElementById('qr-copy-btn');
  const qrClose = document.getElementById('qr-close-btn');
  const qrOpen = document.getElementById('qr-open-link');

  if (qrBtn && qrModal) {
    const displayUrl = `${window.location.origin}/s/${sessionId}/display`;
    const qrSvgUrl = `/s/${sessionId}/qr.svg`;

    qrBtn.addEventListener('click', () => {
      if (qrImg) qrImg.src = qrSvgUrl;
      if (qrUrl) qrUrl.textContent = displayUrl;
      if (qrOpen) qrOpen.href = displayUrl;
      qrModal.removeAttribute('hidden');
    });

    qrClose?.addEventListener('click', () => qrModal.setAttribute('hidden', ''));
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.setAttribute('hidden', '');
    });

    qrCopy?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(displayUrl);
        qrCopy.textContent = 'Copied';
        setTimeout(() => { qrCopy.textContent = 'Copy'; }, 1500);
      } catch { /* clipboard denied */ }
    });
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
