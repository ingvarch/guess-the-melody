// Admin UI renderer. Pure DOM — no side effects.

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function renderGenresTable(doc, genres, opts = {}) {
  const { counts = {}, callbacks } = opts;
  const tbody = doc.getElementById('genres-body');
  if (!tbody) return;
  clearChildren(tbody);

  for (const g of genres) {
    const tr = doc.createElement('tr');

    const slugTd = doc.createElement('td');
    slugTd.textContent = g.slug;

    const nameTd = doc.createElement('td');
    const nameInput = doc.createElement('input');
    nameInput.type = 'text';
    nameInput.value = g.name;
    nameInput.dataset.field = 'name';
    nameInput.dataset.slug = g.slug;
    nameTd.append(nameInput);

    const emojiTd = doc.createElement('td');
    const emojiInput = doc.createElement('input');
    emojiInput.type = 'text';
    emojiInput.value = g.emoji ?? '';
    emojiInput.dataset.field = 'emoji';
    emojiInput.dataset.slug = g.slug;
    emojiTd.append(emojiInput);

    const sortTd = doc.createElement('td');
    const sortInput = doc.createElement('input');
    sortInput.type = 'number';
    sortInput.value = String(g.sort_order);
    sortInput.dataset.field = 'sort_order';
    sortInput.dataset.slug = g.slug;
    sortTd.append(sortInput);

    const countTd = doc.createElement('td');
    countTd.dataset.cell = 'count';
    countTd.className = 'num';
    countTd.textContent = String(counts[g.slug] ?? 0);

    const statusTd = doc.createElement('td');
    const badge = doc.createElement('span');
    badge.className = g.archived ? 'badge badge--archived' : 'badge badge--active';
    badge.textContent = g.archived ? 'Архив' : 'Активен';
    statusTd.append(badge);

    const actionsTd = doc.createElement('td');

    const archiveBtn = doc.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.className = 'btn btn--ghost btn--sm';
    archiveBtn.textContent = g.archived ? 'Восстановить' : 'В архив';
    archiveBtn.dataset.action = g.archived ? 'unarchive' : 'archive';
    archiveBtn.dataset.slug = g.slug;

    const delBtn = doc.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn--ghost btn--sm';
    delBtn.textContent = 'Удалить';
    delBtn.dataset.action = 'delete-genre';
    delBtn.dataset.slug = g.slug;

    actionsTd.append(archiveBtn, delBtn);
    tr.append(slugTd, nameTd, emojiTd, sortTd, countTd, statusTd, actionsTd);
    tbody.append(tr);
  }

  if (callbacks) {
    tbody.addEventListener('change', (e) => {
      const input = e.target.closest('input[data-field]');
      if (!input) return;
      const slug = input.dataset.slug;
      const field = input.dataset.field;
      const value = input.value;
      if (callbacks.onEdit) callbacks.onEdit(slug, field, value);
    });

    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const slug = btn.dataset.slug;
      const action = btn.dataset.action;
      if (action === 'archive' && callbacks.onArchive) callbacks.onArchive(slug, true);
      if (action === 'unarchive' && callbacks.onArchive) callbacks.onArchive(slug, false);
      if (action === 'delete-genre' && callbacks.onDelete) callbacks.onDelete(slug);
    });
  }
}

export function populateGenreSelect(doc, genres, selectId) {
  const select = doc.getElementById(selectId);
  if (!select) return;
  const current = select.value;
  clearChildren(select);
  const placeholder = doc.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— выбрать —';
  placeholder.disabled = true;
  placeholder.selected = true;
  select.append(placeholder);
  for (const g of genres) {
    const opt = doc.createElement('option');
    opt.value = g.slug;
    opt.textContent = `${g.emoji ?? ''} ${g.name}`.trim();
    select.append(opt);
  }
  if (current && genres.some((g) => g.slug === current)) {
    select.value = current;
  }
}

function getCheckedTrackIds(doc) {
  const tbody = doc.getElementById('tracks-body');
  if (!tbody) return [];
  return Array.from(
    tbody.querySelectorAll('input[type="checkbox"][data-action="select-row"]:checked'),
  ).map((cb) => cb.dataset.id);
}

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

// Single source of truth for the per-row play button's look. Used by the
// renderer (initial, stopped) and by main-admin's playback glue on toggle.
export function setPlayButtonState(btn, playing) {
  btn.classList.toggle('is-playing', playing);
  btn.setAttribute('aria-label', playing ? 'Остановить фрагмент' : 'Воспроизвести фрагмент');
  btn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
}

export function renderTracksTable(doc, tracks) {
  const tbody = doc.getElementById('tracks-body');
  if (!tbody) return;

  // Remember checked ids before clearing so re-renders preserve selection.
  const checkedIds = new Set(getCheckedTrackIds(doc));

  clearChildren(tbody);

  for (const t of tracks) {
    const tr = doc.createElement('tr');
    tr.dataset.id = t.id;

    const cbTd = doc.createElement('td');
    cbTd.className = 'px-6 py-4 text-center';
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = t.id;
    cb.dataset.action = 'select-row';
    if (checkedIds.has(t.id)) cb.checked = true;
    cbTd.append(cb);

    const genreTd = doc.createElement('td');
    genreTd.className = 'px-6 py-4';
    genreTd.textContent = t.genre_slug;

    const artistTd = doc.createElement('td');
    artistTd.className = 'px-6 py-4';
    artistTd.textContent = t.artist;

    const titleTd = doc.createElement('td');
    titleTd.className = 'px-6 py-4';
    titleTd.textContent = t.title;

    const yearTd = doc.createElement('td');
    yearTd.className = 'px-6 py-4 text-center num';
    yearTd.textContent = String(t.year);

    const playTd = doc.createElement('td');
    playTd.className = 'px-6 py-4 text-center';
    const playBtn = doc.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'play-btn';
    playBtn.dataset.action = 'play';
    playBtn.dataset.id = t.id;
    setPlayButtonState(playBtn, false);
    playTd.append(playBtn);

    tr.append(cbTd, genreTd, artistTd, titleTd, yearTd, playTd);
    tbody.append(tr);
  }
}

export function renderPagination(doc, { offset, limit, total, onPage }) {
  const root = doc.getElementById('tracks-pagination');
  if (!root) return;
  clearChildren(root);

  const pages = Math.ceil(total / limit);
  const current = Math.floor(offset / limit);

  if (pages <= 1) return;

  for (let i = 0; i < pages; i++) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = String(i + 1);
    btn.disabled = i === current;
    if (i === current) btn.classList.add('active');
    btn.addEventListener('click', () => onPage(i * limit));
    root.append(btn);
  }
}

export function setImportStatus(doc, msg, isError = false) {
  const el = doc.getElementById('import-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'import-status' + (isError ? ' err' : msg ? ' ok' : '');
}

export function setError(doc, msg) {
  const el = doc.getElementById('error');
  if (el) el.textContent = msg;
}

export function renderStats(doc, stats) {
  const set = (id, value) => {
    const el = doc.getElementById(id);
    if (el) el.textContent = String(value);
  };
  set('stat-total-tracks', stats.totalTracks ?? 0);
  set('stat-total-genres', stats.totalGenres ?? 0);
  set('stat-active-genres', stats.activeGenres ?? 0);
}

const LIVE_WINDOW_MS = 60_000;

function fmtAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

const PHASE_LABEL = {
  idle: 'Waiting',
  spinning: 'Picking genre',
  playing: 'Playing',
  revealed: 'Revealed',
};

// Read-only "Live Game" monitor. Renders one card per registry row; the admin
// is not the session owner, so the card only links out to host/display.
export function renderSessions(doc, sessions, { now }) {
  const list = doc.getElementById('sessions-list');
  const empty = doc.getElementById('sessions-empty');
  if (!list) return;
  clearChildren(list);

  if (!sessions || sessions.length === 0) {
    if (empty) empty.removeAttribute('hidden');
    return;
  }
  if (empty) empty.setAttribute('hidden', '');

  for (const s of sessions) {
    const live = now - s.updatedAt < LIVE_WINDOW_MS;

    const card = doc.createElement('article');
    card.className = 'session-card glass-card rounded-xl p-5 space-y-4';
    card.dataset.live = String(live);

    const head = doc.createElement('div');
    head.className = 'flex items-center justify-between gap-3';

    const idWrap = doc.createElement('div');
    idWrap.className = 'flex items-center gap-2';
    const dot = doc.createElement('span');
    dot.className = live
      ? 'w-2 h-2 rounded-full bg-secondary animate-pulse'
      : 'w-2 h-2 rounded-full bg-on-surface-variant/40';
    const code = doc.createElement('span');
    code.className = 'session-card__id font-label-mono text-label-mono text-on-surface tracking-wider';
    code.textContent = s.id;
    idWrap.append(dot, code);

    const badge = doc.createElement('span');
    badge.className = 'font-label-caps text-label-caps px-2 py-1 rounded bg-primary/10 text-primary';
    badge.textContent = PHASE_LABEL[s.phase] ?? s.phase;
    head.append(idWrap, badge);

    const meta = doc.createElement('div');
    meta.className = 'flex flex-wrap gap-x-6 gap-y-1 font-label-mono text-label-mono text-on-surface-variant';
    const genre = doc.createElement('span');
    genre.textContent = `Genre: ${s.selectedGenre ?? '—'}`;
    const rounds = doc.createElement('span');
    rounds.textContent = `Round ${s.roundsPlayed + 1}`;
    const ago = doc.createElement('span');
    ago.textContent = fmtAgo(now - s.updatedAt);
    meta.append(genre, rounds, ago);

    card.append(head, meta);

    if (s.teams && s.teams.length > 0) {
      const board = doc.createElement('ul');
      board.className = 'space-y-1 list-none p-0 m-0';
      const sorted = s.teams.slice().sort((a, b) => b.score - a.score);
      for (const t of sorted) {
        const li = doc.createElement('li');
        li.className = 'flex justify-between items-center text-body-md text-on-surface';
        const name = doc.createElement('span');
        name.className = 'session-team__name';
        name.textContent = t.name;
        const score = doc.createElement('span');
        score.className = 'session-team__score num font-label-mono text-secondary';
        score.textContent = String(t.score);
        li.append(name, score);
        board.append(li);
      }
      card.append(board);
    }

    const actions = doc.createElement('div');
    actions.className = 'flex gap-2 pt-1';
    const hostLink = doc.createElement('a');
    hostLink.href = `/s/${s.id}/`;
    hostLink.target = '_blank';
    hostLink.rel = 'noopener noreferrer';
    hostLink.className = 'px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-on-primary transition-all font-label-caps text-label-caps';
    hostLink.textContent = 'Open Console';
    const dispLink = doc.createElement('a');
    dispLink.href = `/s/${s.id}/display`;
    dispLink.target = '_blank';
    dispLink.rel = 'noopener noreferrer';
    dispLink.className = 'px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:text-secondary hover:border-secondary transition-all font-label-caps text-label-caps';
    dispLink.textContent = 'Open Display';
    actions.append(hostLink, dispLink);
    card.append(actions);

    list.append(card);
  }
}
