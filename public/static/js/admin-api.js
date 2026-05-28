// Admin API wrappers. Pure — no DOM, no globals.
// Each takes `fetchFn` first so tests can stub the network.

export async function getGenres(fetchFn) {
  const res = await fetchFn('/admin/api/genres');
  if (!res.ok) throw new Error(`getGenres: ${res.status}`);
  return res.json();
}

export async function createGenre(fetchFn, payload) {
  const res = await fetchFn('/admin/api/genres', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `createGenre: ${res.status}`);
  }
  return res.json();
}

export async function updateGenre(fetchFn, slug, payload) {
  const res = await fetchFn(`/admin/api/genres/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `updateGenre: ${res.status}`);
  }
  return res.json();
}

export async function deleteGenre(fetchFn, slug) {
  const res = await fetchFn(`/admin/api/genres/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `deleteGenre: ${res.status}`);
  }
}

export async function getTracks(fetchFn, opts = {}) {
  const url = new URL('/admin/api/tracks', typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  if (opts.genreSlug) url.searchParams.set('genre', opts.genreSlug);
  if (opts.search) url.searchParams.set('search', opts.search);
  if (opts.limit) url.searchParams.set('limit', String(opts.limit));
  if (opts.offset) url.searchParams.set('offset', String(opts.offset));
  const res = await fetchFn(url.pathname + url.search);
  if (!res.ok) throw new Error(`getTracks: ${res.status}`);
  return res.json();
}

export async function deleteTrack(fetchFn, id) {
  const res = await fetchFn(`/admin/api/tracks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`deleteTrack: ${res.status}`);
}

export async function importTrack(fetchFn, payload) {
  const res = await fetchFn('/admin/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `importTrack: ${res.status}`);
  }
  return res.json();
}
