// Unit tests for the admin host-console renderer (console-ui.js). Pure DOM via
// happy-dom — the bootstrap (SSE/poll/fetch) lives in main-console.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const { render } = await import('../../public/static/js/console-ui.js');

function makeDoc() {
  const win = new Window();
  win.SyntaxError = SyntaxError;
  win.Error = Error;
  const doc = win.document;
  doc.body.innerHTML = `
    <span id="console-phase"></span>
    <span id="console-genre"></span>
    <span id="console-track"></span>
    <span id="console-rounds"></span>
    <ul id="console-scoreboard"></ul>
    <div id="console-bars"></div>
    <button id="reveal-btn" hidden></button>
    <button id="next-btn" hidden></button>
  `;
  return doc;
}

test('render: shows the host-private answer as the track line', () => {
  const doc = makeDoc();
  render(doc, {
    state: { phase: 'playing', selectedGenre: 'russian-pop', playedTrackIds: [], teams: [] },
    answer: { artist: 'Кино', title: 'Группа крови', year: 1988 },
  });
  assert.equal(doc.getElementById('console-genre').textContent, 'russian-pop');
  const track = doc.getElementById('console-track').textContent;
  assert.ok(track.includes('Кино'));
  assert.ok(track.includes('Группа крови'));
  assert.ok(track.includes('1988'));
});

test('render: track is a dash when there is no current answer', () => {
  const doc = makeDoc();
  render(doc, {
    state: { phase: 'idle', selectedGenre: null, playedTrackIds: [], teams: [] },
    answer: null,
  });
  assert.equal(doc.getElementById('console-track').textContent, '—');
});

test('render: bars animate only while playing', () => {
  const doc = makeDoc();
  render(doc, { state: { phase: 'playing', selectedGenre: null, playedTrackIds: [], teams: [] }, answer: null });
  assert.equal(doc.getElementById('console-bars').classList.contains('is-playing'), true);
  render(doc, { state: { phase: 'revealed', selectedGenre: null, playedTrackIds: [], teams: [] }, answer: null });
  assert.equal(doc.getElementById('console-bars').classList.contains('is-playing'), false);
});

test('render: Reveal shows while playing, Next shows once revealed', () => {
  const doc = makeDoc();
  render(doc, { state: { phase: 'playing', selectedGenre: null, playedTrackIds: [], teams: [] }, answer: null });
  assert.equal(doc.getElementById('reveal-btn').hasAttribute('hidden'), false);
  assert.equal(doc.getElementById('next-btn').hasAttribute('hidden'), true);

  render(doc, { state: { phase: 'revealed', selectedGenre: null, playedTrackIds: [], teams: [] }, answer: null });
  assert.equal(doc.getElementById('reveal-btn').hasAttribute('hidden'), true);
  assert.equal(doc.getElementById('next-btn').hasAttribute('hidden'), false);
});

test('render: scoreboard lists teams sorted by score desc', () => {
  const doc = makeDoc();
  render(doc, {
    state: {
      phase: 'playing', selectedGenre: null, playedTrackIds: ['a', 'b'],
      teams: [{ name: 'Cats', score: 2 }, { name: 'Dogs', score: 5 }],
    },
    answer: null,
  });
  assert.equal(doc.getElementById('console-rounds').textContent, '2');
  const names = Array.from(doc.querySelectorAll('#console-scoreboard .team__name')).map((n) => n.textContent);
  assert.deepEqual(names, ['Dogs', 'Cats']);
});
