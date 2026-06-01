// Admin host-console bootstrap. The page is served under /admin (basic-auth),
// so the browser attaches the admin credentials to /admin/* fetches for us.
//
// Live state comes from the public SSE stream (same as the display). The
// host-private answer comes from the admin sessions registry (basic-auth). Host
// actions (Reveal/Next) POST to the admin action proxy, which authorises the
// write to the DO by password — no owner cookie needed, so a phone can drive a
// game started on a laptop.

import { render } from './console-ui.js';

const sessionId = document.querySelector('meta[name="session-id"]')?.content ?? '';
const ANSWER_POLL_MS = 3000;

if (!sessionId) {
  document.body.textContent = 'no session id';
} else {
  boot();
}

function boot() {
  const view = { state: { phase: 'idle', teams: [], playedTrackIds: [], selectedGenre: null }, answer: null };

  const codeEl = document.getElementById('session-code');
  if (codeEl) codeEl.textContent = sessionId;

  function paint() {
    render(document, view);
  }

  async function postAction(action) {
    try {
      const res = await fetch(`/admin/api/console/${sessionId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok && res.status !== 409) {
        // 409 = invalid transition (e.g. double tap); ignore. Others are real.
        console.warn('console action failed:', res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      console.warn('console action error:', e);
    }
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
    const es = new EventSource(`/s/${sessionId}/api/events`);
    es.addEventListener('state', (e) => {
      try {
        view.state = JSON.parse(e.data);
        paint();
      } catch { /* malformed frame */ }
    });
    // EventSource auto-reconnects with backoff on transient errors.
  }

  document.getElementById('reveal-btn')?.addEventListener('click', () => postAction('reveal'));
  document.getElementById('next-btn')?.addEventListener('click', () => postAction('next'));

  paint();
  connectSse();
  void refreshAnswer();
  setInterval(refreshAnswer, ANSWER_POLL_MS);
}
