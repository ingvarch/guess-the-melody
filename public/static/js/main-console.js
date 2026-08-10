// Admin host-console bootstrap. The page is served under /admin (basic-auth),
// so the browser attaches the admin credentials to /admin/* fetches for us.
//
// Live state comes from the public SSE stream (same as the display). The
// host-private answer comes from the admin sessions registry (basic-auth). Host
// actions (Reveal/Next) POST to the admin action proxy, which authorises the
// write to the DO by password — no owner cookie needed, so a phone can drive a
// game started on a laptop.

import { render, renderClock } from './console-ui.js';
import { connectStateStream } from './sse.js';

const sessionId = document.querySelector('meta[name="session-id"]')?.content ?? '';
const ANSWER_POLL_MS = 3000;
const TICK_MS = 250;

if (!sessionId) {
  document.body.textContent = 'no session id';
} else {
  boot();
}

function boot() {
  const view = { state: { phase: 'idle', teams: [], playedTrackIds: [], selectedGenre: null }, answer: null, genres: [] };

  const codeEl = document.getElementById('session-code');
  if (codeEl) codeEl.textContent = sessionId;

  function paint() {
    render(document, view);
  }

  async function postAction(payload) {
    try {
      const res = await fetch(`/admin/api/console/${sessionId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok && res.status !== 409) {
        // 409 = invalid transition (e.g. double tap); ignore. Others are real.
        console.warn('console action failed:', res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      console.warn('console action error:', e);
    }
  }

  async function loadGenres() {
    try {
      const res = await fetch('/api/genres');
      if (!res.ok) return;
      view.genres = await res.json();
      paint();
    } catch { /* non-fatal; Spin still works with Auto */ }
  }

  async function refreshAnswer() {
    try {
      const res = await fetch('/admin/api/sessions');
      if (!res.ok) return;
      const sessions = await res.json();
      const mine = sessions.find((s) => s.id === sessionId);
      view.answer = mine?.currentAnswer ?? null;
      paint();
    } catch { /* transient; next poll retries */ }
  }

  function connectSse() {
    connectStateStream({
      url: `/s/${sessionId}/api/events`,
      onState: (s) => {
        view.state = s;
        paint();
      },
    });
  }

  document.getElementById('spin-btn')?.addEventListener('click', () => {
    // Empty value = Auto: omit selectedGenre so the DO picks a genre at random.
    const genre = document.getElementById('genre-select')?.value || '';
    postAction(genre ? { action: 'spin', selectedGenre: genre } : { action: 'spin' });
  });
  document.getElementById('play-btn')?.addEventListener('click', (e) => {
    // Resolved by the renderer from live state: play | pause | resume.
    const action = e.currentTarget.dataset.action;
    if (action) postAction({ action });
  });
  document.getElementById('reveal-btn')?.addEventListener('click', () => postAction({ action: 'reveal' }));
  document.getElementById('next-btn')?.addEventListener('click', () => postAction({ action: 'next' }));
  document.getElementById('replay-btn')?.addEventListener('click', () => postAction({ action: 'replay' }));

  // Seek. Authorised by the admin password like every other console action, so
  // it works from any device — no session owner cookie involved.
  const scrubber = document.getElementById('scrubber');
  const endScrub = () => { if (scrubber) delete scrubber.dataset.scrubbing; };
  scrubber?.addEventListener('input', () => { scrubber.dataset.scrubbing = '1'; });
  scrubber?.addEventListener('change', () => {
    endScrub();
    postAction({ action: 'seek', positionSec: Number(scrubber.value) });
  });
  scrubber?.addEventListener('pointercancel', endScrub);

  paint();
  connectSse();
  void loadGenres();
  void refreshAnswer();
  setInterval(refreshAnswer, ANSWER_POLL_MS);
  // Keeps the position readout moving between SSE frames.
  setInterval(() => renderClock(document, view.state), TICK_MS);
}
