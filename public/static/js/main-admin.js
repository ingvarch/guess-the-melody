// Admin bootstrap. Fetches data, wires forms, handles async actions.

import {
  getGenres,
  createGenre,
  updateGenre,
  deleteGenre,
  getTracks,
  deleteTrack,
  importTrack,
} from './admin-api.js';
import {
  renderGenresTable,
  populateGenreSelect,
  renderTracksTable,
  renderPagination,
  setImportStatus,
  setError,
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
    renderTracksTable(document, tracks, async (id) => {
      if (!confirm('Удалить трек?')) return;
      try {
        await deleteTrack(fetch, id);
        await refreshTracks(offset);
      } catch (e) {
        setError(document, e.message);
      }
    });
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
}

async function boot() {
  await refreshGenres();
  await refreshTracks(0);
  wireForms();
}

boot().catch((e) => setError(document, e.message));
