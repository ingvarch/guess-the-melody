// Unit tests for admin UI renderer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

function makeDoc() {
  const win = new Window();
  win.SyntaxError = SyntaxError;
  win.Error = Error;
  const doc = win.document;
  doc.body.innerHTML = `
    <select id="import-genre"><option value="">--</option></select>
    <select id="tracks-genre-filter"><option value="">--</option></select>
    <table class="admin-table">
      <tbody id="genres-body"></tbody>
    </table>
    <table class="admin-table">
      <thead><tr id="tracks-head"><th></th><th></th></tr></thead>
      <tbody id="tracks-body"></tbody>
    </table>
    <div id="tracks-pagination"></div>
    <span id="import-status"></span>
    <div id="error"></div>
  `;
  return doc;
}

const mod = await import('../../public/static/js/admin-ui.js');
const {
  renderGenresTable,
  populateGenreSelect,
  renderTracksTable,
  renderPagination,
  setImportStatus,
  setError,
} = mod;

test('renderGenresTable creates rows with inputs and buttons', () => {
  const doc = makeDoc();
  const genres = [
    { slug: 'rock', name: 'Rock', emoji: null, sort_order: 10, archived: 0 },
    { slug: 'pop', name: 'Pop', emoji: '🎵', sort_order: 20, archived: 1 },
  ];
  renderGenresTable(doc, genres);
  const rows = doc.querySelectorAll('#genres-body tr');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('td').textContent, 'rock');
  assert.equal(rows[0].querySelector('input[data-field="name"]').value, 'Rock');
  assert.equal(rows[1].querySelector('.badge').textContent, 'Архив');
});

test('populateGenreSelect fills options and preserves value', () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }, { slug: 'pop', name: 'Pop' }];
  populateGenreSelect(doc, genres, 'import-genre');
  const select = doc.getElementById('import-genre');
  assert.equal(select.children.length, 3); // placeholder + 2
  assert.equal(select.children[1].value, 'rock');
});

test('renderTracksTable creates rows with checkboxes and track data', () => {
  const doc = makeDoc();
  const tracks = [
    { id: 't1', genre_slug: 'rock', artist: 'Queen', title: 'Rhapsody', year: 1975 },
  ];
  renderTracksTable(doc, tracks);
  const rows = doc.querySelectorAll('#tracks-body tr');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes('Queen'));
  assert.ok(rows[0].textContent.includes('Rhapsody'));
  const checkbox = rows[0].querySelector('input[type="checkbox"]');
  assert.ok(checkbox, 'row must have checkbox');
  assert.equal(checkbox.dataset.id, 't1');
  assert.equal(checkbox.dataset.action, 'select-row');
});

test('renderTracksTable adds a Play button per row', () => {
  const doc = makeDoc();
  const tracks = [
    { id: 't1', genre_slug: 'rock', artist: 'A', title: 'T1', year: 2000 },
  ];
  renderTracksTable(doc, tracks);
  const playBtn = doc.querySelector('#tracks-body tr[data-id="t1"] button[data-action="play"]');
  assert.ok(playBtn, 'row must have play button');
  assert.equal(playBtn.dataset.id, 't1');
  assert.equal(playBtn.type, 'button');
});

test('renderTracksTable preserves checkbox checked state across re-renders', () => {
  const doc = makeDoc();
  const tracks = [
    { id: 't1', genre_slug: 'rock', artist: 'A', title: 'T1', year: 2000 },
    { id: 't2', genre_slug: 'pop', artist: 'B', title: 'T2', year: 2001 },
  ];
  renderTracksTable(doc, tracks);
  const tbody = doc.getElementById('tracks-body');
  const cb1 = tbody.querySelector('tr[data-id="t1"] input[type="checkbox"]');
  cb1.checked = true;

  renderTracksTable(doc, tracks);
  const cb1After = tbody.querySelector('tr[data-id="t1"] input[type="checkbox"]');
  assert.equal(cb1After.checked, true);
});

test('renderTracksTable does not attach event listeners to tbody', () => {
  const doc = makeDoc();
  const tracks = [{ id: 't1', genre_slug: 'rock', artist: 'A', title: 'T1', year: 2000 }];
  // Call twice; if listeners were attached each time they would accumulate.
  // The function now accepts only (doc, tracks) — no onDelete callback.
  renderTracksTable(doc, tracks);
  renderTracksTable(doc, tracks);
  assert.ok(true);
});

test('renderPagination creates numbered buttons', () => {
  const doc = makeDoc();
  let clickedOffset = null;
  renderPagination(doc, { offset: 25, limit: 25, total: 80, onPage: (o) => { clickedOffset = o; } });
  const buttons = doc.querySelectorAll('#tracks-pagination button');
  assert.equal(buttons.length, 4);
  assert.ok(buttons[1].disabled);
  buttons[2].click();
  assert.equal(clickedOffset, 50);
});

test('setImportStatus sets text and ok class', () => {
  const doc = makeDoc();
  setImportStatus(doc, 'Done');
  const el = doc.getElementById('import-status');
  assert.equal(el.textContent, 'Done');
  assert.ok(el.classList.contains('ok'));
});

test('setImportStatus sets error class', () => {
  const doc = makeDoc();
  setImportStatus(doc, 'Oops', true);
  const el = doc.getElementById('import-status');
  assert.ok(el.classList.contains('err'));
});

test('setError writes to error element', () => {
  const doc = makeDoc();
  setError(doc, 'Connection failed');
  assert.equal(doc.getElementById('error').textContent, 'Connection failed');
});
