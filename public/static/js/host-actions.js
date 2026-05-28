// Host POST dispatchers. Pure: no DOM, no globals. Every wrapper takes
// `fetchFn` first so the unit tests can stub the network without touching
// real `fetch`. Each wrapper mirrors a single DO action; payload shape is
// the contract with the state machine in `logic.js`.

function sessionPath(sessionId, suffix) {
  return `/s/${sessionId}${suffix}`;
}

export async function postAction(fetchFn, sessionId, payload) {
  const res = await fetchFn(sessionPath(sessionId, '/api/state'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let text;
    try { text = await res.text(); } catch { text = res.statusText; }
    throw new Error(`action ${payload.action} failed: ${res.status} ${text}`);
  }
  return res.json();
}

export const addTeam    = (f, s, id, name)             => postAction(f, s, { action: 'team.add', id, name });
export const renameTeam = (f, s, id, name)             => postAction(f, s, { action: 'team.rename', id, name });
export const removeTeam = (f, s, id)                   => postAction(f, s, { action: 'team.remove', id });
export const spin       = (f, s, selectedGenre = null) => postAction(f, s, selectedGenre ? { action: 'spin', selectedGenre } : { action: 'spin' });
export const play       = (f, s)                       => postAction(f, s, { action: 'play', now: Date.now() });
export const award      = (f, s, teamId, points)       => postAction(f, s, { action: 'award', teamId, points });
export const reveal     = (f, s)                       => postAction(f, s, { action: 'reveal' });
export const next       = (f, s)                       => postAction(f, s, { action: 'next' });
export const endgame    = (f, s, resetScores = false)  => postAction(f, s, { action: 'endgame', resetScores });

export async function fetchGenres(fetchFn) {
  const res = await fetchFn('/api/genres');
  if (!res.ok) throw new Error(`fetchGenres: ${res.status}`);
  return res.json();
}

export async function fetchState(fetchFn, sessionId) {
  const res = await fetchFn(sessionPath(sessionId, '/api/state'));
  if (!res.ok) throw new Error(`fetchState: ${res.status}`);
  return res.json();
}
