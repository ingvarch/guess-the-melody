// Admin bootstrap. Fetches data, wires forms, handles async actions.

import {
  getGenres,
  createGenre,
  updateGenre,
  deleteGenre,
  getTracks,
  deleteTrack,
  importTrack,
  getSessions,
} from './admin-api.js';
import {
  renderGenresTable,
  populateGenreSelect,
  renderTracksTable,
  renderPagination,
  setImportStatus,
  setError,
  renderSessions,
} from './admin-ui.js';

let currentGenres = [];
let tracksOffset = 0;
const TRACKS_LIMIT = 25;
let currentTracksFilter = { genreSlug: '', search: '' };

async function refreshGenres() {
  try {
    currentGenres = await getGenres(fetch);
    renderGenresTable(document, currentGenres, {
      onEdit: async (slug, field, value) => {
        const payload =
          field === 'sort_order'
            ? { sortOrder: Number(value) }
            : { [field]: value };
        try {
          await updateGenre(fetch, slug, payload);
          await refreshGenres();
        } catch (e) {
          setError(document, e.message);
        }
      },
      onArchive: async (slug, archived) => {
        try {
          await updateGenre(fetch, slug, { archived });
          await refreshGenres();
        } catch (e) {
          setError(document, e.message);
        }
      },
      onDelete: async (slug) => {
        if (!confirm(`Удалить жанр «${slug}»?`)) return;
        try {
          await deleteGenre(fetch, slug);
          await refreshGenres();
        } catch (e) {
          setError(document, e.message);
        }
      },
    });
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
  btn.textContent = 'Pause';
  btn.classList.add('is-playing');
}

function markStopped(btn) {
  btn.textContent = 'Play';
  btn.classList.remove('is-playing');
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
        await refreshTracks(0);
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
      const emoji = document.getElementById('genre-emoji')?.value.trim() || null;
      const sortOrder = Number(document.getElementById('genre-sort')?.value);
      if (!slug || !name || !Number.isFinite(sortOrder)) return;
      try {
        await createGenre(fetch, { slug, name, emoji, sortOrder });
        document.getElementById('genre-slug').value = '';
        document.getElementById('genre-name').value = '';
        document.getElementById('genre-emoji').value = '';
        await refreshGenres();
      } catch (e) {
        setError(document, e.message);
      }
    });
  }

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

  // Per-row Play button. Single shared audio element; clicking another row's
  // button stops whatever is currently playing.
  if (tracksBody) {
    tracksBody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="play"]');
      if (btn) togglePlay(btn);
    });
  }

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
        await refreshTracks(tracksOffset);
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

function setActiveNav(activeBtn, inactiveBtn) {
  activeBtn?.classList.add(...NAV_ACTIVE);
  activeBtn?.classList.remove('text-on-surface-variant');
  inactiveBtn?.classList.remove(...NAV_ACTIVE);
  inactiveBtn?.classList.add('text-on-surface-variant');
}

function showView(view) {
  const live = document.getElementById('live-view');
  const catalogue = document.getElementById('catalogue-view');
  const title = document.getElementById('view-title');
  const refreshBtn = document.getElementById('sessions-refresh-btn');
  const navLive = document.getElementById('nav-live');
  const navLibrary = document.getElementById('nav-library');
  if (!live || !catalogue) return;

  if (sessionsTimer) { clearInterval(sessionsTimer); sessionsTimer = null; }

  if (view === 'live') {
    live.removeAttribute('hidden');
    catalogue.classList.add('hidden');
    if (title) title.textContent = 'Live Game';
    refreshBtn?.removeAttribute('hidden');
    setActiveNav(navLive, navLibrary);
    void refreshSessions();
    // Poll while the monitor is on screen; rows are advisory and update often.
    sessionsTimer = setInterval(refreshSessions, 5000);
  } else {
    live.setAttribute('hidden', '');
    catalogue.classList.remove('hidden');
    if (title) title.textContent = 'Song Library';
    refreshBtn?.setAttribute('hidden', '');
    setActiveNav(navLibrary, navLive);
  }
}

function wireNav() {
  document.getElementById('nav-live')?.addEventListener('click', () => showView('live'));
  document.getElementById('nav-library')?.addEventListener('click', () => showView('library'));
  document.getElementById('sessions-refresh-btn')?.addEventListener('click', () => void refreshSessions());
}

async function boot() {
  // Catalogue management is admin-only (basic-auth /admin/api/*). The host page
  // (/s/<id>/) authenticates with an owner cookie, not basic auth, so running
  // these fetches there would 401 and spam the shared #error region. The host
  // page carries a session-id meta tag; bail out when present.
  if (document.querySelector('meta[name="session-id"]')) return;
  await refreshGenres();
  await refreshTracks(0);
  wireForms();
  wireNav();
}

boot().catch((e) => setError(document, e.message));
