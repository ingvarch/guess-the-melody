// Display bootstrap. Renders the cinematic display, mirrors host SSE, AND
// drives the gameplay control surface (spin/play/reveal/next/award/teams).
// Anonymous viewers see the same controls; their POSTs will 403 against the
// DO owner-cookie check. Acceptable for the MVP — the URL is unguessable.

import { render, renderClock, runSpin, renderPlaybackControls, shouldBeAudible } from './display-ui.js';
import { connectStateStream } from './sse.js';
import { createSoundGate } from './sound-gate.js';
import {
  fetchGenres,
  fetchState,
  addTeam,
  removeTeam,
  renameTeam,
  spin,
  play,
  replay,
  pause,
  resume,
  award,
  reveal,
  next,
} from './host-actions.js';
import { attachWaveform } from './waveform.js';

const sessionId = document.querySelector('meta[name="session-id"]')?.content ?? '';
const TICK_MS = 250;

const DO_ERRORS = {
  'no tracks available': 'No tracks available (all genres are empty or archived)',
  'no current track': 'No current track',
  'track not found': 'Track not found',
};

function teamId() {
  return 't_' + Math.random().toString(36).slice(2, 10);
}

function showError(msg) {
  const mapped = DO_ERRORS[msg] ?? msg;
  // Display has no dedicated error region; fall back to alert for non-403 errors.
  // 403s from owner-cookie checks are swallowed in the catch sites below.
  if (mapped) console.warn('display action error:', mapped);
}

function silentlyIgnore403(err) {
  if (err instanceof Error && /\b403\b/.test(err.message)) return;
  showError(err instanceof Error ? err.message : String(err));
}

function boot() {
  if (!sessionId) {
    document.body.textContent = 'no session id';
    return;
  }

  const view = { state: {}, genres: [], sessionId };
  let waveformCtrl = null;
  let prevPhase = null;

  // Owns starting audible playback: retried on every state frame and clock
  // tick, so a blocked autoplay recovers as soon as the page gets a gesture.
  const gate = createSoundGate({
    doc: document,
    audio: document.getElementById('audio'),
    getWaveform: () => waveformCtrl,
  });

  function onState() {
    render(document, view);
    // Expose phase to the inline visualiser so the bars react only while playing.
    document.body.dataset.phase = view.state.phase ?? '';

    if (prevPhase !== 'spinning' && view.state.phase === 'spinning') {
      void runSpin(document, view.state, view.genres, { getPhase: () => view.state.phase });
    }

    if (view.state.phase === 'playing') {
      // Attach the analyser exactly once for the page lifetime; reuse it every
      // round. Re-attaching would call createMediaElementSource twice and throw.
      if (!waveformCtrl) {
        waveformCtrl = attachWaveform({
          audioEl: document.getElementById('audio'),
          canvas: document.getElementById('waveform'),
        });
      }
      void waveformCtrl?.resume?.();
    } else if (prevPhase === 'playing') {
      // Leaving playback (reveal or skip): pause the render loop only. The
      // AudioContext stays open so the next round still produces sound.
      waveformCtrl?.stop?.();
    }

    prevPhase = view.state.phase;
    gate.sync(shouldBeAudible(view.state));
  }

  async function init() {
    try {
      const [s, g] = await Promise.all([
        fetchState(fetch, sessionId),
        fetchGenres(fetch).catch(() => []),
      ]);
      view.state = s;
      view.genres = g;
      prevPhase = s.phase;
      onState();
    } catch (e) {
      document.body.insertAdjacentHTML('beforeend', `<p style="color:red">${e.message}</p>`);
    }
  }

  function connectSse() {
    connectStateStream({
      url: `/s/${sessionId}/api/events`,
      onState: (s) => {
        view.state = s;
        onState();
      },
    });
  }

  function wireEvents() {
    const spinBtn = document.getElementById('spin-btn');
    spinBtn?.addEventListener('click', () => {
      // Empty value = "Surprise me (Auto)" → no genre; the server picks at random.
      const genre = document.getElementById('genre-select')?.value || null;
      spin(fetch, sessionId, genre).catch(silentlyIgnore403);
    });

    const playBtn = document.getElementById('play-btn');
    playBtn?.addEventListener('click', () => {
      // Context-aware: start the clip while spinning, otherwise toggle
      // pause/resume during playback. The DO stamps the authoritative `now`.
      const st = view.state;
      if (st.phase === 'spinning') {
        play(fetch, sessionId).catch(silentlyIgnore403);
      } else if (st.phase === 'playing') {
        const act = st.audioPausedTimestamp != null ? resume : pause;
        act(fetch, sessionId).catch(silentlyIgnore403);
      }
    });

    const replayBtn = document.getElementById('replay-btn');
    replayBtn?.addEventListener('click', () => {
      // Re-stamp the start timestamp on the DO so every viewer restarts in sync.
      replay(fetch, sessionId).catch(silentlyIgnore403);
    });

    const revealBtn = document.getElementById('reveal-btn');
    revealBtn?.addEventListener('click', () => {
      reveal(fetch, sessionId).catch(silentlyIgnore403);
    });

    const nextBtn = document.getElementById('next-btn');
    nextBtn?.addEventListener('click', () => {
      next(fetch, sessionId).catch(silentlyIgnore403);
    });

    // Exit: leave the game and return to the landing page. The session keeps
    // living server-side, so the URL still works if reopened.
    const endBtn = document.getElementById('endgame-btn');
    endBtn?.addEventListener('click', () => {
      if (!confirm('Leave the game?')) return;
      window.location.href = '/';
    });

    // Award buttons delegated from scoreboard footer.
    const scoreboard = document.getElementById('scoreboard-list');
    scoreboard?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="award"]');
      if (!btn) return;
      const id = btn.dataset.teamId;
      const points = Number(btn.dataset.points);
      if (!id || !(points === 1 || points === 2)) return;
      award(fetch, sessionId, id, points).catch(silentlyIgnore403);
    });

    // Teams panel toggle.
    const teamsPanel = document.getElementById('teams-panel');
    const teamsToggle = document.getElementById('teams-toggle-btn');
    const teamsClose = document.getElementById('teams-panel-close-btn');
    teamsToggle?.addEventListener('click', () => {
      if (teamsPanel?.hasAttribute('hidden')) teamsPanel.removeAttribute('hidden');
      else teamsPanel?.setAttribute('hidden', '');
    });
    teamsClose?.addEventListener('click', () => teamsPanel?.setAttribute('hidden', ''));

    // Add team form.
    const addForm = document.getElementById('add-team-form');
    addForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('add-team-input');
      const name = input?.value.trim();
      if (!name) return;
      addTeam(fetch, sessionId, teamId(), name)
        .then(() => { if (input) input.value = ''; })
        .catch(silentlyIgnore403);
    });

    // Teams list rename/remove.
    const teamsList = document.getElementById('teams-list');
    teamsList?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.teamId;
      if (!id) return;
      if (btn.dataset.action === 'remove') {
        removeTeam(fetch, sessionId, id).catch(silentlyIgnore403);
      } else if (btn.dataset.action === 'rename') {
        const current = view.state.teams?.find((t) => t.id === id)?.name ?? '';
        const proposed = prompt('New team name', current);
        if (proposed === null) return;
        const trimmed = proposed.trim();
        if (!trimmed) return;
        renameTeam(fetch, sessionId, id, trimmed).catch(silentlyIgnore403);
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void init();
  });

  void init();
  connectSse();
  wireEvents();
  setInterval(() => {
    renderClock(document, view.state);
    // Surface Reveal/Repeat the moment the 30s clip elapses, without a server msg.
    renderPlaybackControls(document, view.state);
    gate.sync(shouldBeAudible(view.state));
  }, TICK_MS);
}

boot();
