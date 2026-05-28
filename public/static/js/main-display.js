// Display bootstrap. Mirrors the host SSE + render loop, but read-only.
// Triggers jukebox spin animation and waveform attach on phase transitions.

import { render, runSpin } from './display-ui.js';
import { attachWaveform } from './waveform.js';

const sessionId = document.querySelector('meta[name="session-id"]')?.content ?? '';

async function fetchGenres(fetchFn) {
  const res = await fetchFn('/api/genres');
  if (!res.ok) return [];
  return res.json();
}

async function fetchState(fetchFn, sid) {
  const res = await fetchFn(`/s/${sid}/api/state`);
  if (!res.ok) throw new Error(`fetchState: ${res.status}`);
  return res.json();
}

function boot() {
  if (!sessionId) {
    document.body.textContent = 'no session id';
    return;
  }

  const view = { state: {}, genres: [], sessionId };
  let waveformCtrl = null;
  let prevPhase = null;

  function onState() {
    render(document, view);

    // Phase transition: idle -> spinning -> run spin animation.
    if (prevPhase !== 'spinning' && view.state.phase === 'spinning') {
      void runSpin(document, view.state, view.genres);
    }

    // Phase transition: spinning -> playing -> attach/resume waveform.
    if (prevPhase !== 'playing' && view.state.phase === 'playing') {
      if (!waveformCtrl) {
        waveformCtrl = attachWaveform({
          audioEl: document.getElementById('audio'),
          canvas: document.getElementById('waveform'),
        });
      }
      if (waveformCtrl?.resume) {
        void waveformCtrl.resume();
      }
    }

    // Phase transition: playing -> revealed -> stop waveform.
    if (prevPhase === 'playing' && view.state.phase === 'revealed') {
      if (waveformCtrl) {
        waveformCtrl.stop();
        waveformCtrl = null;
      }
    }

    prevPhase = view.state.phase;
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
    const es = new EventSource(`/s/${sessionId}/api/events`);
    es.addEventListener('state', (e) => {
      try {
        view.state = JSON.parse(e.data);
        onState();
      } catch { /* malformed frame */ }
    });
    // Browser auto-reconnects on transient errors.
  }

  // Re-fetch + reconnect when tab wakes from sleep.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void init();
  });

  void init();
  connectSse();
}

boot();
