// Admin UI renderer. Pure DOM — no side effects.

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function renderGenresTable(doc, genres, callbacks) {
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
    tr.append(slugTd, nameTd, emojiTd, sortTd, statusTd, actionsTd);
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
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = t.id;
    cb.dataset.action = 'select-row';
    if (checkedIds.has(t.id)) cb.checked = true;
    cbTd.append(cb);

    const genreTd = doc.createElement('td');
    genreTd.textContent = t.genre_slug;

    const artistTd = doc.createElement('td');
    artistTd.textContent = t.artist;

    const titleTd = doc.createElement('td');
    titleTd.textContent = t.title;

    const yearTd = doc.createElement('td');
    yearTd.className = 'num';
    yearTd.textContent = String(t.year);

    const playTd = doc.createElement('td');
    const playBtn = doc.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn btn--ghost btn--sm play-btn';
    playBtn.dataset.action = 'play';
    playBtn.dataset.id = t.id;
    playBtn.setAttribute('aria-label', 'Воспроизвести фрагмент');
    playBtn.textContent = 'Play';
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
