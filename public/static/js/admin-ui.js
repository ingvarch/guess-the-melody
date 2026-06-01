// Admin UI renderer. Pure DOM — no side effects.

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Read-only rows in Song Library style; editing happens in the genre modal.
// Pure DOM — the edit click is delegated in main-admin.
export function renderGenresTable(doc, genres, opts = {}) {
  const { counts = {} } = opts;
  const tbody = doc.getElementById('genres-body');
  if (!tbody) return;
  clearChildren(tbody);

  for (const g of genres) {
    const tr = doc.createElement('tr');
    tr.dataset.slug = g.slug;

    const sortTd = doc.createElement('td');
    sortTd.className = 'px-6 py-4 text-center num';
    sortTd.dataset.col = 'order';
    sortTd.textContent = String(g.sort_order);

    const slugTd = doc.createElement('td');
    slugTd.className = 'px-6 py-4 font-label-mono text-label-mono';
    slugTd.dataset.col = 'slug';
    slugTd.textContent = g.slug;

    const nameTd = doc.createElement('td');
    nameTd.className = 'px-6 py-4';
    nameTd.dataset.col = 'name';
    nameTd.textContent = g.name;

    const countTd = doc.createElement('td');
    countTd.dataset.cell = 'count';
    countTd.dataset.col = 'count';
    countTd.className = 'px-6 py-4 text-center num';
    countTd.textContent = String(counts[g.slug] ?? 0);

    const statusTd = doc.createElement('td');
    statusTd.className = 'px-6 py-4 text-center';
    statusTd.dataset.col = 'status';
    const badge = doc.createElement('span');
    badge.className = g.archived ? 'badge badge--archived' : 'badge badge--active';
    badge.textContent = g.archived ? 'Архив' : 'Активен';
    statusTd.append(badge);

    const actionsTd = doc.createElement('td');
    actionsTd.className = 'px-6 py-4 text-center';
    actionsTd.dataset.col = 'actions';
    const actions = doc.createElement('div');
    actions.className = 'track-actions';
    const editBtn = doc.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.dataset.action = 'edit';
    editBtn.dataset.slug = g.slug;
    editBtn.setAttribute('aria-label', 'Редактировать жанр');
    editBtn.innerHTML = EDIT_ICON;
    actions.append(editBtn);
    actionsTd.append(actions);

    tr.append(sortTd, slugTd, nameTd, countTd, statusTd, actionsTd);
    tbody.append(tr);
  }
}

// opts.placeholder sets the first option's label. opts.placeholderSelectable
// keeps it enabled (value '') so it works as a "reset / all" choice for the
// filter; left disabled it is a "you must pick" prompt for the import select.
export function populateGenreSelect(doc, genres, selectId, opts = {}) {
  const { placeholder = '— Genre —', placeholderSelectable = false } = opts;
  const select = doc.getElementById(selectId);
  if (!select) return;
  const current = select.value;
  clearChildren(select);
  const placeholderOpt = doc.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = placeholder;
  placeholderOpt.disabled = !placeholderSelectable;
  placeholderOpt.selected = true;
  select.append(placeholderOpt);
  for (const g of genres) {
    const opt = doc.createElement('option');
    opt.value = g.slug;
    opt.textContent = g.name;
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
const EDIT_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

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
    cbTd.dataset.col = 'select';
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = t.id;
    cb.dataset.action = 'select-row';
    if (checkedIds.has(t.id)) cb.checked = true;
    cbTd.append(cb);

    const genreTd = doc.createElement('td');
    genreTd.className = 'px-6 py-4';
    genreTd.dataset.col = 'genre';
    genreTd.textContent = t.genre_slug;

    const artistTd = doc.createElement('td');
    artistTd.className = 'px-6 py-4';
    artistTd.dataset.col = 'artist';
    artistTd.textContent = t.artist;

    const titleTd = doc.createElement('td');
    titleTd.className = 'px-6 py-4';
    titleTd.dataset.col = 'title';
    titleTd.textContent = t.title;

    const yearTd = doc.createElement('td');
    yearTd.className = 'px-6 py-4 text-center num';
    yearTd.dataset.col = 'year';
    yearTd.textContent = String(t.year);

    const actionsTd = doc.createElement('td');
    actionsTd.className = 'px-6 py-4 text-center';
    actionsTd.dataset.col = 'actions';
    const actions = doc.createElement('div');
    actions.className = 'track-actions';
    const playBtn = doc.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'play-btn';
    playBtn.dataset.action = 'play';
    playBtn.dataset.id = t.id;
    setPlayButtonState(playBtn, false);
    const editBtn = doc.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.dataset.action = 'edit';
    editBtn.dataset.id = t.id;
    editBtn.setAttribute('aria-label', 'Редактировать трек');
    editBtn.innerHTML = EDIT_ICON;
    actions.append(playBtn, editBtn);
    actionsTd.append(actions);

    tr.append(cbTd, genreTd, artistTd, titleTd, yearTd, actionsTd);
    tbody.append(tr);
  }
}

// ---- Track editor modal ----

// Fills the modal fields from a track and reveals it. `genres` populates the
// genre select; the track's current genre is pre-selected.
export function openTrackEditor(doc, track, genres) {
  populateGenreSelect(doc, genres, 'track-edit-genre');
  const genre = doc.getElementById('track-edit-genre');
  if (genre) genre.value = track.genre_slug;
  const artist = doc.getElementById('track-edit-artist');
  if (artist) artist.value = track.artist ?? '';
  const title = doc.getElementById('track-edit-title');
  if (title) title.value = track.title ?? '';
  const year = doc.getElementById('track-edit-year');
  if (year) year.value = String(track.year ?? '');
  const form = doc.getElementById('track-editor-form');
  if (form) form.dataset.id = track.id;
  setTrackEditorError(doc, '');
  const overlay = doc.getElementById('track-editor');
  if (overlay) overlay.removeAttribute('hidden');
}

export function closeTrackEditor(doc) {
  const overlay = doc.getElementById('track-editor');
  if (overlay) overlay.setAttribute('hidden', '');
}

// Reads the current field values back out. `year` is numeric; `artist`/`title`
// are trimmed. The caller decides what to send (server patches by key).
export function readTrackEditor(doc) {
  const form = doc.getElementById('track-editor-form');
  return {
    id: form?.dataset.id ?? '',
    genreSlug: doc.getElementById('track-edit-genre')?.value ?? '',
    artist: (doc.getElementById('track-edit-artist')?.value ?? '').trim(),
    title: (doc.getElementById('track-edit-title')?.value ?? '').trim(),
    year: Number(doc.getElementById('track-edit-year')?.value),
  };
}

export function setTrackEditorError(doc, msg) {
  const el = doc.getElementById('track-edit-error');
  if (el) el.textContent = msg;
}

// ---- Track import modal ----

// Step 1 of adding a track. Resets fields, populates the genre select, reveals
// the modal. On a successful import the caller hands off to openTrackEditor.
export function openTrackImporter(doc, genres) {
  populateGenreSelect(doc, genres, 'import-genre');
  const url = doc.getElementById('import-url');
  if (url) url.value = '';
  const itunes = doc.getElementById('import-itunes-id');
  if (itunes) itunes.value = '';
  setImportStatus(doc, '');
  const overlay = doc.getElementById('track-import');
  if (overlay) overlay.removeAttribute('hidden');
}

export function closeTrackImporter(doc) {
  const overlay = doc.getElementById('track-import');
  if (overlay) overlay.setAttribute('hidden', '');
}

export function readTrackImporter(doc) {
  const out = {
    url: (doc.getElementById('import-url')?.value ?? '').trim(),
    genreSlug: doc.getElementById('import-genre')?.value ?? '',
  };
  const raw = doc.getElementById('import-itunes-id')?.value;
  if (raw) out.itunesIdOverride = Number(raw);
  return out;
}

// ---- Genre editor modal ----

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

// Edit mode: slug is immutable (server ignores it) so the field is locked.
// Delete + Archive apply to the existing row; the archive label flips on state.
export function openGenreEditor(doc, genre) {
  const slug = doc.getElementById('genre-edit-slug');
  if (slug) { slug.value = genre.slug; slug.readOnly = true; }
  const name = doc.getElementById('genre-edit-name');
  if (name) name.value = genre.name ?? '';
  const sort = doc.getElementById('genre-edit-sort');
  if (sort) sort.value = String(genre.sort_order ?? '');
  const archiveBtn = doc.getElementById('genre-edit-archive');
  if (archiveBtn) archiveBtn.textContent = genre.archived ? 'Восстановить' : 'В архив';
  setHidden(doc.getElementById('genre-edit-archive'), false);
  setHidden(doc.getElementById('genre-edit-delete'), false);
  const title = doc.getElementById('genre-editor-title');
  if (title) title.textContent = 'Edit Genre';
  const form = doc.getElementById('genre-editor-form');
  if (form) {
    form.dataset.mode = 'edit';
    form.dataset.slug = genre.slug;
    form.dataset.archived = String(genre.archived ? 1 : 0);
  }
  setGenreEditorError(doc, '');
  const overlay = doc.getElementById('genre-editor');
  if (overlay) overlay.removeAttribute('hidden');
}

// Create mode: same modal, empty fields, editable slug. Delete + Archive make
// no sense for a row that does not exist yet, so they are hidden.
export function openGenreCreator(doc) {
  const slug = doc.getElementById('genre-edit-slug');
  if (slug) { slug.value = ''; slug.readOnly = false; }
  const name = doc.getElementById('genre-edit-name');
  if (name) name.value = '';
  const sort = doc.getElementById('genre-edit-sort');
  if (sort) sort.value = '100';
  setHidden(doc.getElementById('genre-edit-archive'), true);
  setHidden(doc.getElementById('genre-edit-delete'), true);
  const title = doc.getElementById('genre-editor-title');
  if (title) title.textContent = 'Add Genre';
  const form = doc.getElementById('genre-editor-form');
  if (form) {
    form.dataset.mode = 'create';
    form.dataset.slug = '';
    form.dataset.archived = '0';
  }
  setGenreEditorError(doc, '');
  const overlay = doc.getElementById('genre-editor');
  if (overlay) overlay.removeAttribute('hidden');
}

export function closeGenreEditor(doc) {
  const overlay = doc.getElementById('genre-editor');
  if (overlay) overlay.setAttribute('hidden', '');
}

export function readGenreEditor(doc) {
  const form = doc.getElementById('genre-editor-form');
  return {
    mode: form?.dataset.mode === 'create' ? 'create' : 'edit',
    slug: (doc.getElementById('genre-edit-slug')?.value ?? '').trim(),
    name: (doc.getElementById('genre-edit-name')?.value ?? '').trim(),
    sortOrder: Number(doc.getElementById('genre-edit-sort')?.value),
    archived: form?.dataset.archived === '1' ? 1 : 0,
  };
}

export function setGenreEditorError(doc, msg) {
  const el = doc.getElementById('genre-edit-error');
  if (el) el.textContent = msg;
}

const CHEVRON_LEFT =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
const CHEVRON_RIGHT =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>';

// Page indices (0-based) to render, with '…' markers for collapsed runs.
// Always keeps first, last and a one-page window around the current page.
function paginationItems(pages, current) {
  const radius = 1;
  const show = new Set([0, pages - 1]);
  for (let i = current - radius; i <= current + radius; i++) {
    if (i >= 0 && i < pages) show.add(i);
  }
  const sorted = Array.from(show).sort((a, b) => a - b);
  const items = [];
  let prev = -1;
  for (const p of sorted) {
    if (prev >= 0 && p - prev > 1) items.push('…');
    items.push(p);
    prev = p;
  }
  return items;
}

export function renderPagination(doc, { offset, limit, total, onPage }) {
  const root = doc.getElementById('tracks-pagination');
  if (!root) return;
  clearChildren(root);

  const pages = Math.ceil(total / limit);
  const current = Math.floor(offset / limit);
  if (pages <= 1) return;

  const navBtn = (dir, target, enabled) => {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'page-nav';
    btn.dataset.nav = dir;
    btn.disabled = !enabled;
    btn.setAttribute('aria-label', dir === 'prev' ? 'Предыдущая страница' : 'Следующая страница');
    btn.innerHTML = dir === 'prev' ? CHEVRON_LEFT : CHEVRON_RIGHT;
    if (enabled) btn.addEventListener('click', () => onPage(target * limit));
    return btn;
  };

  root.append(navBtn('prev', current - 1, current > 0));

  for (const item of paginationItems(pages, current)) {
    if (item === '…') {
      const gap = doc.createElement('span');
      gap.className = 'page-gap';
      gap.textContent = '…';
      gap.setAttribute('aria-hidden', 'true');
      root.append(gap);
      continue;
    }
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'page-btn';
    btn.dataset.page = String(item);
    btn.textContent = String(item + 1);
    if (item === current) {
      btn.classList.add('active');
      btn.disabled = true;
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.addEventListener('click', () => onPage(item * limit));
    }
    root.append(btn);
  }

  root.append(navBtn('next', current + 1, current < pages - 1));
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

    // Host-private answer peek: lets the judge verify guesses without revealing
    // on the public display. Only present while a round has a current track.
    if (s.currentAnswer) {
      const answer = doc.createElement('div');
      answer.className = 'session-card__answer flex items-center gap-2 rounded-lg px-3 py-2 bg-primary/10 text-primary font-label-mono text-label-mono';
      const icon = doc.createElement('span');
      icon.className = 'material-symbols-outlined text-[18px]';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = 'lightbulb';
      const text = doc.createElement('span');
      const { artist, title, year } = s.currentAnswer;
      text.textContent = `${artist} — ${title}${year ? ` (${year})` : ''}`;
      answer.append(icon, text);
      card.append(answer);
    }

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
    const delBtn = doc.createElement('button');
    delBtn.type = 'button';
    delBtn.dataset.action = 'delete-session';
    delBtn.dataset.id = s.id;
    delBtn.className = 'ml-auto px-3 py-1.5 rounded-lg border border-error/40 text-error hover:bg-error/10 transition-all font-label-caps text-label-caps';
    delBtn.textContent = 'Delete';
    actions.append(hostLink, dispLink, delBtn);
    card.append(actions);

    list.append(card);
  }
}
