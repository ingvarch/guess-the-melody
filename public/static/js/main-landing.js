// Landing-page click handler. `startGame` is pure-ish (fetch + location are
// injectable) so it can be unit-tested in Bun without a DOM. `init` wires
// the handler onto #start when a real document is present.

export async function startGame({
  fetchFn = fetch,
  location = window.location,
} = {}) {
  const res = await fetchFn('/api/session', { method: 'POST' });
  if (!res.ok) {
    throw new Error(`session creation failed: ${res.status}`);
  }
  const data = await res.json();
  if (typeof data.sessionId !== 'string') {
    throw new Error('bad session response');
  }
  location.href = `/s/${data.sessionId}/display`;
  return data.sessionId;
}

export function init(doc = document) {
  const btn = doc.getElementById('start');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await startGame();
    } catch (e) {
      btn.disabled = false;
      const msg = doc.getElementById('error');
      if (msg) {
        msg.textContent = e instanceof Error ? e.message : String(e);
      } else {
        alert(`error: ${e}`);
      }
    }
  });
}

// Auto-init only inside a real browser. Bun's test runner has no `document`,
// so importing the module from a test must remain a no-op here.
if (typeof document !== 'undefined') {
  init();
}
