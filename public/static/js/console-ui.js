// Admin host-console renderer. Pure DOM — no fetch, no globals. The console is
// a private monitor (basic-auth gated): it shows the current track's answer so
// the host can judge guesses, mirrors the live scoreboard, animates a "playing"
// bar effect, and exposes Reveal + Next. Actual spin/play stays on /display.

function setText(doc, id, value) {
  const el = doc.getElementById(id);
  if (el) el.textContent = value;
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function answerText(answer) {
  if (!answer) return '—';
  const { artist, title, year } = answer;
  return `${artist} — ${title}${year ? ` (${year})` : ''}`;
}

function renderScoreboard(doc, teams) {
  const list = doc.getElementById('console-scoreboard');
  if (!list) return;
  clearChildren(list);
  const sorted = teams.slice().sort((a, b) => b.score - a.score);
  for (const team of sorted) {
    const li = doc.createElement('li');
    li.className = 'team flex items-center justify-between gap-3 bg-surface-container-low/50 rounded-lg px-4 py-3';
    const name = doc.createElement('span');
    name.className = 'team__name font-body-md text-body-md text-on-surface truncate';
    name.textContent = team.name;
    const score = doc.createElement('span');
    score.className = 'team__score num font-headline-lg text-headline-lg-mobile text-secondary';
    score.textContent = String(team.score);
    li.append(name, score);
    list.append(li);
  }
}

export function render(doc, { state, answer }) {
  setText(doc, 'console-phase', state.phase);
  setText(doc, 'console-genre', state.selectedGenre ?? '—');
  setText(doc, 'console-track', answerText(answer));
  setText(doc, 'console-rounds', String(state.playedTrackIds?.length ?? 0));

  renderScoreboard(doc, state.teams ?? []);

  const bars = doc.getElementById('console-bars');
  if (bars) bars.classList.toggle('is-playing', state.phase === 'playing');

  // Reveal mid-round; Next once revealed. The DO is the final guard on validity.
  setHidden(doc.getElementById('reveal-btn'), state.phase !== 'playing');
  setHidden(doc.getElementById('next-btn'), state.phase !== 'revealed');
}
