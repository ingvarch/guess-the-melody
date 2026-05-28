// Unit tests for admin UI renderer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    <div id="sessions-list"></div>
    <p id="sessions-empty" hidden></p>
  `;
  return doc;
}

function tracksHeadCells() {
  const html = readFileSync(
    fileURLToPath(new URL('../../public/admin.html', import.meta.url)),
    'utf8',
  );
  const win = new Window();
  win.SyntaxError = SyntaxError;
  win.Error = Error;
  win.document.body.innerHTML = html;
  const table = win.document.getElementById('tracks-body').closest('table');
  return Array.from(table.querySelectorAll('thead th'));
}

function alignOf(el) {
  if (el.classList.contains('text-center')) return 'center';
  if (el.classList.contains('text-right')) return 'right';
  return 'left';
}

const mod = await import('../../public/static/js/admin-ui.js');
const {
  renderGenresTable,
  populateGenreSelect,
  renderTracksTable,
  renderPagination,
  setImportStatus,
  setError,
  renderSessions,
  setPlayButtonState,
} = mod;

test('renderSessions shows empty state when no sessions', () => {
  const doc = makeDoc();
  renderSessions(doc, [], { now: 1000 });
  assert.equal(doc.getElementById('sessions-empty').hasAttribute('hidden'), false);
  assert.equal(doc.getElementById('sessions-list').children.length, 0);
});

test('renderSessions renders a card per session with links and leaderboard', () => {
  const doc = makeDoc();
  const now = 1_000_000;
  renderSessions(doc, [
    {
      id: 'ABC123', phase: 'playing', selectedGenre: 'rock', roundsPlayed: 3,
      teamCount: 2, updatedAt: now - 2000, createdAt: now - 60000,
      teams: [{ name: 'Cats', score: 2 }, { name: 'Dogs', score: 5 }],
    },
  ], { now });
  assert.equal(doc.getElementById('sessions-empty').hasAttribute('hidden'), true);
  const cards = doc.querySelectorAll('.session-card');
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.ok(card.textContent.includes('ABC123'));
  assert.ok(card.textContent.toLowerCase().includes('rock'));
  // Links to host + display for that session.
  const hrefs = Array.from(card.querySelectorAll('a')).map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('/s/ABC123/'));
  assert.ok(hrefs.includes('/s/ABC123/display'));
  // Leaderboard sorted desc: Dogs (5) before Cats (2).
  const names = Array.from(card.querySelectorAll('.session-team__name')).map((n) => n.textContent);
  assert.deepEqual(names, ['Dogs', 'Cats']);
});

test('renderSessions flags a fresh session as live', () => {
  const doc = makeDoc();
  const now = 1_000_000;
  renderSessions(doc, [
    { id: 'LIVE1', phase: 'spinning', selectedGenre: null, roundsPlayed: 0, teamCount: 0, updatedAt: now - 5000, createdAt: now - 5000, teams: [] },
    { id: 'OLD1', phase: 'idle', selectedGenre: null, roundsPlayed: 0, teamCount: 0, updatedAt: now - 600000, createdAt: now - 600000, teams: [] },
  ], { now });
  const cards = doc.querySelectorAll('.session-card');
  assert.equal(cards[0].dataset.live, 'true');
  assert.equal(cards[1].dataset.live, 'false');
});

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

test('tracks table header column count matches rendered row cells', () => {
  // The static <thead> in admin.html must line up with renderTracksTable's
  // <td> output, or every column shifts (regression: artist/title split
  // without updating the header).
  const ths = tracksHeadCells();

  const doc = makeDoc();
  renderTracksTable(doc, [
    { id: 't1', genre_slug: 'rock', artist: 'Queen', title: 'Rhapsody', year: 1975 },
  ]);
  const tds = doc.querySelectorAll('#tracks-body tr td');

  assert.equal(ths.length, tds.length, 'thead <th> count must equal row <td> count');

  const labels = ths.map((th) => th.textContent.trim());
  for (const expected of ['Genre', 'Artist', 'Title', 'Year', 'Actions']) {
    assert.ok(labels.includes(expected), `header must include "${expected}", got ${JSON.stringify(labels)}`);
  }
});

test('tracks columns share horizontal alignment + padding between header and body', () => {
  // Content drifts when a <th> centers but its <td> defaults to left (or the
  // td lacks the header's px-6 padding). Lock alignment + padding per column.
  const ths = tracksHeadCells();
  const doc = makeDoc();
  renderTracksTable(doc, [
    { id: 't1', genre_slug: 'rock', artist: 'Queen', title: 'Rhapsody', year: 1975 },
  ]);
  const tds = Array.from(doc.querySelectorAll('#tracks-body tr td'));

  ths.forEach((th, i) => {
    assert.equal(alignOf(tds[i]), alignOf(th), `column ${i} alignment th vs td`);
    assert.ok(tds[i].classList.contains('px-6'), `column ${i} td needs px-6 to match header`);
    assert.ok(tds[i].classList.contains('py-4'), `column ${i} td needs py-4 to match header`);
  });
});

test('checkbox, year and actions columns are centered in both header and body', () => {
  const ths = tracksHeadCells();
  const labels = ths.map((th) => th.textContent.trim());
  const doc = makeDoc();
  renderTracksTable(doc, [
    { id: 't1', genre_slug: 'rock', artist: 'Queen', title: 'Rhapsody', year: 1975 },
  ]);
  const tds = Array.from(doc.querySelectorAll('#tracks-body tr td'));

  // checkbox column is index 0 (its th holds the select-all checkbox).
  assert.equal(alignOf(ths[0]), 'center', 'checkbox header centered');
  assert.equal(alignOf(tds[0]), 'center', 'checkbox cell centered');

  const yearIdx = labels.indexOf('Year');
  assert.equal(alignOf(ths[yearIdx]), 'center', 'Year header centered');
  assert.equal(alignOf(tds[yearIdx]), 'center', 'Year cell centered');

  const actionsIdx = labels.indexOf('Actions');
  assert.equal(alignOf(ths[actionsIdx]), 'center', 'Actions header centered');
  assert.equal(alignOf(tds[actionsIdx]), 'center', 'Actions cell centered');
});

test('play button renders an icon, not a text label', () => {
  const doc = makeDoc();
  renderTracksTable(doc, [
    { id: 't1', genre_slug: 'rock', artist: 'A', title: 'T1', year: 2000 },
  ]);
  const btn = doc.querySelector('#tracks-body button[data-action="play"]');
  assert.ok(btn.querySelector('svg'), 'play button must contain an svg icon');
  assert.equal(btn.textContent.trim(), '', 'play button must not show text');
  assert.ok(btn.getAttribute('aria-label'), 'play button keeps an aria-label');
  assert.equal(btn.classList.contains('is-playing'), false);
});

test('setPlayButtonState toggles playing icon, class and aria-label', () => {
  const doc = makeDoc();
  renderTracksTable(doc, [
    { id: 't1', genre_slug: 'rock', artist: 'A', title: 'T1', year: 2000 },
  ]);
  const btn = doc.querySelector('#tracks-body button[data-action="play"]');
  const idle = btn.getAttribute('aria-label');

  setPlayButtonState(btn, true);
  assert.ok(btn.classList.contains('is-playing'));
  assert.ok(btn.querySelector('svg'), 'still has an icon when playing');
  assert.notEqual(btn.getAttribute('aria-label'), idle, 'aria-label changes while playing');

  setPlayButtonState(btn, false);
  assert.equal(btn.classList.contains('is-playing'), false);
  assert.equal(btn.getAttribute('aria-label'), idle, 'aria-label restored when stopped');
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
