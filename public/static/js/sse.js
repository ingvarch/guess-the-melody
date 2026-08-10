// EventSource dies for good when the server answers with an HTTP error
// (deploy window, transient 5xx): browsers only auto-retry network drops.
// This wrapper watches for the CLOSED state and reopens with capped backoff.
// Missed frames are not a problem: the DO sends a full snapshot on connect.

const CLOSED = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;

export function connectStateStream({
  url,
  onState,
  makeSource = (u) => new EventSource(u),
  schedule = (fn, ms) => setTimeout(fn, ms),
}) {
  let es = null;
  let attempt = 0;
  let closed = false;

  function open() {
    if (closed) return;
    es = makeSource(url);
    es.addEventListener('state', (e) => {
      attempt = 0;
      try {
        onState(JSON.parse(e.data));
      } catch { /* malformed frame */ }
    });
    es.addEventListener('error', () => {
      if (es.readyState !== CLOSED) return; // browser is retrying on its own
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
      attempt += 1;
      schedule(open, delay);
    });
  }

  open();
  return {
    close() {
      closed = true;
      es?.close();
    },
  };
}
