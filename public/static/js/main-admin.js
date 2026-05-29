// Admin bootstrap. Fetches data, wires forms, handles async actions.

import {
  getGenres,
  createGenre,
  updateGenre,
  deleteGenre,
  getTracks,
  updateTrack,
  deleteTrack,
  importTrack,
  getSessions,
  getStats,
} from './admin-api.js';
import {
  renderGenresTable,
  populateGenreSelect,
  renderTracksTable,
  renderPagination,
  setImportStatus,
  setError,
  renderSessions,
  setPlayButtonState,
  renderStats,
  openTrackEditor,
  closeTrackEditor,
  readTrackEditor,
  setTrackEditorError,
  openTrackImporter,
  closeTrackImporter,
  readTrackImporter,
  openGenreEditor,
  openGenreCreator,
  closeGenreEditor,
  readGenreEditor,
  setGenreEditorError,
} from './admin-ui.js';

let currentGenres = [];
let currentTracks = [];
let currentStats = { perGenre: {} };
let tracksOffset = 0;
const TRACKS_LIMIT = 25;
let currentTracksFilter = { genreSlug: '', search: '' };

async function refreshStats() {
  try {
    currentStats = await getStats(fetch);
    renderStats(document, currentStats);
  } catch (e) {
    setError(document, e.message);
  }
}

async function refreshGenres() {
  try {
    currentGenres = await getGenres(fetch);
    renderGenresTable(document, currentGenres, { counts: currentStats.perGenre });
    populateGenreSelect(document, currentGenres.filter((g) => !g.archived), 'import-genre');
    populateGenreSelect(document, currentGenres, 'tracks-genre-filter');
  } catch (e) {
    setError(document, e.message);
  }
}

async function refreshTracks(offset = 0) {
  tracksOffset = offset;
  try {
    const tracks = await getTracks(fetch, {
      ...currentTracksFilter,
      limit: TRACKS_LIMIT,
      offset,
    });
    currentTracks = tracks;
    renderTracksTable(document, tracks);
    updateBulkDeleteVisibility();
    // Approximate total for pagination (heuristic: if we got a full page, there are more).
    const total = tracks.length === TRACKS_LIMIT ? offset + tracks.length + 1 : offset + tracks.length;
    renderPagination(document, {
      offset,
      limit: TRACKS_LIMIT,
      total,
      onPage: (o) => refreshTracks(o),
    });
  } catch (e) {
    setError(document, e.message);
  }
}

function updateBulkDeleteVisibility() {
  const btn = document.getElementById('bulk-delete-btn');
  if (!btn) return;
  const checked = document.querySelectorAll('#tracks-body input[type="checkbox"][data-action="select-row"]:checked');
  btn.hidden = checked.length === 0;
  btn.textContent = checked.length > 0
    ? `Удалить выбранные (${checked.length})`
    : 'Удалить выбранные';
}

let currentPlayingBtn = null;

function togglePlay(btn) {
  const audio = document.getElementById('admin-audio');
  if (!audio) return;
  const id = btn.dataset.id;
  const src = `/admin/api/tracks/${encodeURIComponent(id)}.mp3`;

  // Same button: toggle pause/play.
  if (currentPlayingBtn === btn && !audio.paused) {
    audio.pause();
    return;
  }
  if (currentPlayingBtn === btn && audio.paused) {
    audio.play().catch((e) => setError(document, e.message));
    return;
  }

  // Different track: stop previous, restart on this one.
  if (currentPlayingBtn) markStopped(currentPlayingBtn);
  audio.src = src;
  audio.currentTime = 0;
  audio.play().catch((e) => setError(document, e.message));
  currentPlayingBtn = btn;
  markPlaying(btn);

  audio.onpause = () => markStopped(btn);
  audio.onended = () => {
    markStopped(btn);
    currentPlayingBtn = null;
  };
  audio.onplay = () => markPlaying(btn);
}

function markPlaying(btn) {
  setPlayButtonState(btn, true);
}

function markStopped(btn) {
  setPlayButtonState(btn, false);
}

function wireTrackEditor() {
  const form = document.getElementById('track-editor-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { id, genreSlug, artist, title, year } = readTrackEditor(document);
      if (!artist || !title || !Number.isFinite(year)) {
        setTrackEditorError(document, 'Заполните все поля');
        return;
      }
      try {
        await updateTrack(fetch, id, { genreSlug, artist, title, year });
        closeTrackEditor(document);
        await refreshStats();
        await refreshTracks(tracksOffset);
        await refreshGenres();
      } catch (err) {
        setTrackEditorError(document, err.message);
      }
    });
  }

  const delBtn = document.getElementById('track-edit-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const { id, artist, title } = readTrackEditor(document);
      if (!confirm(`Удалить трек «${artist} – ${title}»?`)) return;
      try {
        await deleteTrack(fetch, id);
        closeTrackEditor(document);
        await refreshStats();
        await refreshTracks(tracksOffset);
        await refreshGenres();
      } catch (err) {
        setTrackEditorError(document, err.message);
      }
    });
  }

  document.getElementById('track-edit-cancel')?.addEventListener('click', () => closeTrackEditor(document));
  document.getElementById('track-editor-backdrop')?.addEventListener('click', () => closeTrackEditor(document));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('track-editor')?.hasAttribute('hidden')) {
      closeTrackEditor(document);
    }
  });
}

function wireGenreEditor() {
  const form = document.getElementById('genre-editor-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { mode, slug, name, sortOrder } = readGenreEditor(document);
      if (!name || !Number.isFinite(sortOrder)) {
        setGenreEditorError(document, 'Заполните название и порядок');
        return;
      }
      if (mode === 'create' && !/^[a-z0-9-]+$/.test(slug)) {
        setGenreEditorError(document, 'Slug: только a-z, 0-9 и дефис');
        return;
      }
      try {
        if (mode === 'create') {
          await createGenre(fetch, { slug, name, sortOrder });
        } else {
          await updateGenre(fetch, slug, { name, sortOrder });
        }
        closeGenreEditor(document);
        await refreshStats();
        await refreshGenres();
      } catch (err) {
        setGenreEditorError(document, err.message);
      }
    });
  }

  const archiveBtn = document.getElementById('genre-edit-archive');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      const { slug, archived } = readGenreEditor(document);
      try {
        await updateGenre(fetch, slug, { archived: archived === 0 });
        closeGenreEditor(document);
        await refreshStats();
        await refreshGenres();
      } catch (err) {
        setGenreEditorError(document, err.message);
      }
    });
  }

  const delBtn = document.getElementById('genre-edit-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const { slug } = readGenreEditor(document);
      if (!confirm(`Удалить жанр «${slug}»?`)) return;
      try {
        await deleteGenre(fetch, slug);
        closeGenreEditor(document);
        await refreshStats();
        await refreshGenres();
      } catch (err) {
        setGenreEditorError(document, err.message);
      }
    });
  }

  document.getElementById('genre-edit-cancel')?.addEventListener('click', () => closeGenreEditor(document));
  document.getElementById('genre-editor-backdrop')?.addEventListener('click', () => closeGenreEditor(document));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('genre-editor')?.hasAttribute('hidden')) {
      closeGenreEditor(document);
    }
  });
}

function wireTrackImporter() {
  // Add Track button opens the import modal (step 1). Only active genres are
  // valid import targets.
  document.getElementById('track-add-btn')?.addEventListener('click', () =>
    openTrackImporter(document, currentGenres.filter((g) => !g.archived)),
  );

  const form = document.getElementById('track-import-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { url, genreSlug, itunesIdOverride } = readTrackImporter(document);
      if (!url || !genreSlug) {
        setImportStatus(document, 'Укажите ссылку и жанр', true);
        return;
      }
      const payload = { url, genreSlug };
      if (itunesIdOverride && Number.isFinite(itunesIdOverride)) {
        payload.itunesIdOverride = itunesIdOverride;
      }
      setImportStatus(document, 'Импорт... качаем превью');
      try {
        const created = await importTrack(fetch, payload);
        await refreshStats();
        await refreshTracks(0);
        await refreshGenres();
        // Hand off to the editor so genre/title can be corrected (iTunes often
        // returns transliterated names). genre_slug comes from the import form.
        closeTrackImporter(document);
        openTrackEditor(document, { ...created, genre_slug: genreSlug }, currentGenres);
      } catch (err) {
        setImportStatus(document, err.message, true);
      }
    });
  }

  document.getElementById('track-import-cancel')?.addEventListener('click', () => closeTrackImporter(document));
  document.getElementById('track-import-backdrop')?.addEventListener('click', () => closeTrackImporter(document));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('track-import')?.hasAttribute('hidden')) {
      closeTrackImporter(document);
    }
  });
}

function wireForms() {
  wireTrackImporter();

  // Add Genre button — opens the shared editor modal in create mode.
  document.getElementById('genre-add-btn')?.addEventListener('click', () => openGenreCreator(document));

  // Genre row — the edit pencil or a tap anywhere on the row (the mobile card)
  // opens the editor modal.
  const genresBody = document.getElementById('genres-body');
  if (genresBody) {
    genresBody.addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-slug]');
      if (!row) return;
      const genre = currentGenres.find((g) => g.slug === row.dataset.slug);
      if (genre) openGenreEditor(document, genre);
    });
  }
  wireGenreEditor();

  // Tracks filter.
  const searchBtn = document.getElementById('tracks-search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      currentTracksFilter.genreSlug = document.getElementById('tracks-genre-filter')?.value || '';
      currentTracksFilter.search = document.getElementById('tracks-search')?.value.trim() || '';
      refreshTracks(0);
    });
  }
  const searchInput = document.getElementById('tracks-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchBtn?.click();
    });
  }

  // Select-all checkbox.
  const selectAll = document.getElementById('select-all');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const checkboxes = document.querySelectorAll('#tracks-body input[type="checkbox"][data-action="select-row"]');
      for (const cb of checkboxes) {
        cb.checked = selectAll.checked;
      }
      updateBulkDeleteVisibility();
    });
  }

  // Track-row checkbox delegation — update button visibility on any change.
  const tracksBody = document.getElementById('tracks-body');
  if (tracksBody) {
    tracksBody.addEventListener('change', (e) => {
      if (e.target.closest('input[type="checkbox"][data-action="select-row"]')) {
        updateBulkDeleteVisibility();
      }
    });
  }

  // Per-row interactions. Play uses a single shared audio element (clicking
  // another row's button stops the current one). The checkbox toggles bulk
  // selection. Anything else — the edit pencil or a tap anywhere on the row
  // (the mobile card) — opens the editor.
  if (tracksBody) {
    tracksBody.addEventListener('click', (e) => {
      const playBtn = e.target.closest('button[data-action="play"]');
      if (playBtn) { togglePlay(playBtn); return; }
      if (e.target.closest('input[type="checkbox"]')) return;
      const row = e.target.closest('tr[data-id]');
      if (!row) return;
      const track = currentTracks.find((t) => t.id === row.dataset.id);
      if (track) openTrackEditor(document, track, currentGenres);
    });
  }

  wireTrackEditor();

  // Bulk delete.
  const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', async () => {
      const selected = Array.from(
        document.querySelectorAll('#tracks-body input[type="checkbox"][data-action="select-row"]:checked'),
      ).map((cb) => cb.dataset.id);
      if (selected.length === 0) return;
      if (!confirm(`Удалить ${selected.length} трек(ов)?`)) return;
      try {
        for (const id of selected) {
          await deleteTrack(fetch, id);
        }
        await refreshStats();
        await refreshTracks(tracksOffset);
        await refreshGenres();
      } catch (e) {
        setError(document, e.message);
      }
    });
  }
}

// ---- Live Game monitor ----

const NAV_ACTIVE = ['text-secondary', 'bg-secondary-container/10', 'border-r-4', 'border-secondary'];
let sessionsTimer = null;

async function refreshSessions() {
  if (!document.getElementById('sessions-list')) return;
  try {
    const sessions = await getSessions(fetch);
    renderSessions(document, sessions, { now: Date.now() });
  } catch (e) {
    setError(document, e.message);
  }
}

const VIEWS = {
  live: { section: 'live-view', nav: 'nav-live', title: 'Live Games' },
  library: { section: 'catalogue-view', nav: 'nav-library', title: 'Song Library' },
  genres: { section: 'genres-view', nav: 'nav-genres', title: 'Genres' },
};

function setActiveNav(view) {
  // Desktop sidebar buttons (highlighted via Tailwind utility classes).
  for (const [key, v] of Object.entries(VIEWS)) {
    const btn = document.getElementById(v.nav);
    if (!btn) continue;
    if (key === view) {
      btn.classList.add(...NAV_ACTIVE);
      btn.classList.remove('text-on-surface-variant');
    } else {
      btn.classList.remove(...NAV_ACTIVE);
      btn.classList.add('text-on-surface-variant');
    }
  }
  // Mobile header tabs (highlighted via aria-current in admin.css).
  for (const tab of document.querySelectorAll('.admin-tab[data-view]')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

function showView(view) {
  const cfg = VIEWS[view] ?? VIEWS.library;
  if (sessionsTimer) { clearInterval(sessionsTimer); sessionsTimer = null; }

  for (const [key, v] of Object.entries(VIEWS)) {
    const section = document.getElementById(v.section);
    if (!section) continue;
    if (key === view) section.removeAttribute('hidden');
    else section.setAttribute('hidden', '');
  }

  const title = document.getElementById('view-title');
  if (title) title.textContent = cfg.title;

  const refreshBtn = document.getElementById('sessions-refresh-btn');
  if (view === 'live') {
    refreshBtn?.removeAttribute('hidden');
    void refreshSessions();
    // Poll while the monitor is on screen; rows are advisory and update often.
    sessionsTimer = setInterval(refreshSessions, 5000);
  } else {
    refreshBtn?.setAttribute('hidden', '');
  }

  setActiveNav(view);
}

function wireNav() {
  document.getElementById('nav-live')?.addEventListener('click', () => showView('live'));
  document.getElementById('nav-library')?.addEventListener('click', () => showView('library'));
  document.getElementById('nav-genres')?.addEventListener('click', () => showView('genres'));
  // Mobile header tabs mirror the sidebar.
  for (const tab of document.querySelectorAll('.admin-tab[data-view]')) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  }
  document.getElementById('sessions-refresh-btn')?.addEventListener('click', () => void refreshSessions());
}

async function boot() {
  // Catalogue management is admin-only (basic-auth /admin/api/*). The host page
  // (/s/<id>/) authenticates with an owner cookie, not basic auth, so running
  // these fetches there would 401 and spam the shared #error region. The host
  // page carries a session-id meta tag; bail out when present.
  if (document.querySelector('meta[name="session-id"]')) return;
  await refreshStats();
  await refreshGenres();
  await refreshTracks(0);
  wireForms();
  wireNav();
  showView('library');
}

boot().catch((e) => setError(document, e.message));
