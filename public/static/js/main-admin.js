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
  openGenreEditor,
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
      const { slug, name, sortOrder } = readGenreEditor(document);
      if (!name || !Number.isFinite(sortOrder)) {
        setGenreEditorError(document, 'Заполните название и порядок');
        return;
      }
      try {
        await updateGenre(fetch, slug, { name, sortOrder });
        closeGenreEditor(document);
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

function wireForms() {
  // Import form.
  const importForm = document.getElementById('import-form');
  if (importForm) {
    importForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('import-url')?.value.trim();
      const genreSlug = document.getElementById('import-genre')?.value;
      const itunesIdRaw = document.getElementById('import-itunes-id')?.value;
      const itunesIdOverride = itunesIdRaw ? Number(itunesIdRaw) : undefined;
      if (!url || !genreSlug) return;
      setImportStatus(document, 'Импорт...');
      try {
        const payload = { url, genreSlug };
        if (itunesIdOverride && Number.isFinite(itunesIdOverride)) {
          payload.itunesIdOverride = itunesIdOverride;
        }
        await importTrack(fetch, payload);
        setImportStatus(document, 'Готово!');
        document.getElementById('import-url').value = '';
        document.getElementById('import-itunes-id').value = '';
        await refreshStats();
        await refreshTracks(0);
        await refreshGenres();
      } catch (e) {
        setImportStatus(document, e.message, true);
      }
    });
  }

  // Add genre form.
  const genreForm = document.getElementById('add-genre-form');
  if (genreForm) {
    genreForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const slug = document.getElementById('genre-slug')?.value.trim();
      const name = document.getElementById('genre-name')?.value.trim();
      const sortOrder = Number(document.getElementById('genre-sort')?.value);
      if (!slug || !name || !Number.isFinite(sortOrder)) return;
      try {
        await createGenre(fetch, { slug, name, sortOrder });
        document.getElementById('genre-slug').value = '';
        document.getElementById('genre-name').value = '';
        await refreshStats();
        await refreshGenres();
      } catch (e) {
        setError(document, e.message);
      }
    });
  }

  // Per-row genre Edit button — opens the editor modal.
  const genresBody = document.getElementById('genres-body');
  if (genresBody) {
    genresBody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('button[data-action="edit"]');
      if (!editBtn) return;
      const genre = currentGenres.find((g) => g.slug === editBtn.dataset.slug);
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

  // Per-row Play button (single shared audio element; clicking another row's
  // button stops the current one) and Edit button (opens the editor modal).
  if (tracksBody) {
    tracksBody.addEventListener('click', (e) => {
      const playBtn = e.target.closest('button[data-action="play"]');
      if (playBtn) { togglePlay(playBtn); return; }
      const editBtn = e.target.closest('button[data-action="edit"]');
      if (editBtn) {
        const track = currentTracks.find((t) => t.id === editBtn.dataset.id);
        if (track) openTrackEditor(document, track, currentGenres);
      }
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

function setActiveNav(activeNavId) {
  for (const v of Object.values(VIEWS)) {
    const btn = document.getElementById(v.nav);
    if (!btn) continue;
    if (v.nav === activeNavId) {
      btn.classList.add(...NAV_ACTIVE);
      btn.classList.remove('text-on-surface-variant');
    } else {
      btn.classList.remove(...NAV_ACTIVE);
      btn.classList.add('text-on-surface-variant');
    }
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

  setActiveNav(cfg.nav);
}

function wireNav() {
  document.getElementById('nav-live')?.addEventListener('click', () => showView('live'));
  document.getElementById('nav-library')?.addEventListener('click', () => showView('library'));
  document.getElementById('nav-genres')?.addEventListener('click', () => showView('genres'));
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
