// Unit tests for the admin host-console renderer (console-ui.js). Pure DOM via
// happy-dom — the bootstrap (SSE/poll/fetch) lives in main-console.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const { render, renderClock, spinPayload } = await import('../../public/static/js/console-ui.js');

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
    <div id="idle-controls" hidden>
      <select id="genre-select"></select>
      <button id="spin-btn"></button>
      <select id="boost-select"></select>
      <select id="boost-chance">
        <option value="0.25">25%</option>
        <option value="0.5" selected>50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
      </select>
    </div>
    <button id="play-btn" hidden><span class="material-symbols-outlined"></span><span class="play-btn__label"></span></button>
    <button id="reveal-btn" hidden></button>
    <button id="replay-btn" hidden></button>
    <button id="next-btn" hidden></button>
    <div id="seek-row" hidden>
      <input id="scrubber" type="range" min="0" max="30" step="0.1" value="0" disabled>
      <span id="time-readout"></span>
    </div>
  `;
  return doc;
}

const GENRES = [
  { slug: 'russian-pop', name: 'Russian Pop' },
  { slug: 'rock', name: 'Rock' },
];

function st(over) {
  return { phase: 'idle', selectedGenre: null, playedTrackIds: [], teams: [], audioPausedTimestamp: null, ...over };
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

test('render: genre select offers Auto plus every genre, preselecting Auto', () => {
  const doc = makeDoc();
  render(doc, { state: st(), answer: null, genres: GENRES });
  const opts = Array.from(doc.querySelectorAll('#genre-select option')).map((o) => o.value);
  assert.deepEqual(opts, ['', 'russian-pop', 'rock']);
  assert.equal(doc.querySelector('#genre-select option').textContent, 'Surprise me (Auto)');
});

test('render: genre select is enabled only at idle', () => {
  const doc = makeDoc();
  render(doc, { state: st({ phase: 'idle' }), answer: null, genres: GENRES });
  assert.equal(doc.getElementById('genre-select').disabled, false);
  render(doc, { state: st({ phase: 'playing' }), answer: null, genres: GENRES });
  assert.equal(doc.getElementById('genre-select').disabled, true);
});

test('render: genre select preserves the host selection across re-renders', () => {
  const doc = makeDoc();
  render(doc, { state: st(), answer: null, genres: GENRES });
  doc.getElementById('genre-select').value = 'rock';
  render(doc, { state: st(), answer: null, genres: GENRES });
  assert.equal(doc.getElementById('genre-select').value, 'rock');
});

test('render: boost select offers Off plus every genre, preselecting Off', () => {
  const doc = makeDoc();
  render(doc, { state: st(), answer: null, genres: GENRES });
  const opts = Array.from(doc.querySelectorAll('#boost-select option')).map((o) => o.value);
  assert.deepEqual(opts, ['', 'russian-pop', 'rock']);
  assert.equal(doc.querySelector('#boost-select option').textContent, 'Off');
  assert.equal(doc.getElementById('boost-select').value, '');
});

test('render: boost select preserves the host choice across re-renders', () => {
  const doc = makeDoc();
  render(doc, { state: st(), answer: null, genres: GENRES });
  doc.getElementById('boost-select').value = 'rock';
  render(doc, { state: st(), answer: null, genres: GENRES });
  assert.equal(doc.getElementById('boost-select').value, 'rock');
});

test('spinPayload: plain auto spin when no boost is set', () => {
  const doc = makeDoc();
  render(doc, { state: st(), answer: null, genres: GENRES });
  assert.deepEqual(spinPayload(doc), { action: 'spin' });
});

test('spinPayload: auto spin carries the boosted genre and its chance', () => {
  const doc = makeDoc();
  render(doc, { state: st(), answer: null, genres: GENRES });
  doc.getElementById('boost-select').value = 'rock';
  doc.getElementById('boost-chance').value = '0.75';
  assert.deepEqual(spinPayload(doc), { action: 'spin', boostGenre: 'rock', boostChance: 0.75 });
});

test('spinPayload: a chosen genre drops the boost', () => {
  const doc = makeDoc();
  render(doc, { state: st(), answer: null, genres: GENRES });
  doc.getElementById('genre-select').value = 'russian-pop';
  doc.getElementById('boost-select').value = 'rock';
  assert.deepEqual(spinPayload(doc), { action: 'spin', selectedGenre: 'russian-pop' });
});

test('render: idle controls (genre + spin) show only at idle', () => {
  const doc = makeDoc();
  render(doc, { state: st({ phase: 'idle' }), answer: null, genres: GENRES });
  assert.equal(doc.getElementById('idle-controls').hasAttribute('hidden'), false);
  render(doc, { state: st({ phase: 'spinning' }), answer: null, genres: GENRES });
  assert.equal(doc.getElementById('idle-controls').hasAttribute('hidden'), true);
});

test('render: play button hidden at idle and revealed', () => {
  const doc = makeDoc();
  render(doc, { state: st({ phase: 'idle' }), answer: null, genres: GENRES });
  assert.equal(doc.getElementById('play-btn').hasAttribute('hidden'), true);
  render(doc, { state: st({ phase: 'revealed' }), answer: null, genres: GENRES });
  assert.equal(doc.getElementById('play-btn').hasAttribute('hidden'), true);
});

test('render: play button starts the clip while spinning', () => {
  const doc = makeDoc();
  render(doc, { state: st({ phase: 'spinning' }), answer: null, genres: GENRES });
  const btn = doc.getElementById('play-btn');
  assert.equal(btn.hasAttribute('hidden'), false);
  assert.equal(btn.dataset.action, 'play');
  assert.equal(btn.querySelector('.play-btn__label').textContent, 'PLAY');
  assert.equal(btn.querySelector('.material-symbols-outlined').textContent, 'play_arrow');
});

test('render: play button stops (pauses) a running clip', () => {
  const doc = makeDoc();
  render(doc, { state: st({ phase: 'playing', audioPausedTimestamp: null }), answer: null, genres: GENRES });
  const btn = doc.getElementById('play-btn');
  assert.equal(btn.hasAttribute('hidden'), false);
  assert.equal(btn.dataset.action, 'pause');
  assert.equal(btn.querySelector('.play-btn__label').textContent, 'STOP');
  assert.equal(btn.querySelector('.material-symbols-outlined').textContent, 'stop');
});

test('render: play button resumes a paused clip', () => {
  const doc = makeDoc();
  render(doc, { state: st({ phase: 'playing', audioPausedTimestamp: 123 }), answer: null, genres: GENRES });
  const btn = doc.getElementById('play-btn');
  assert.equal(btn.dataset.action, 'resume');
  assert.equal(btn.querySelector('.play-btn__label').textContent, 'PLAY');
  assert.equal(btn.querySelector('.material-symbols-outlined').textContent, 'play_arrow');
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

test('seek row: hidden unless a clip is loaded, enabled only while playing', () => {
  const doc = makeDoc();
  const row = () => doc.getElementById('seek-row').hasAttribute('hidden');
  const scrub = () => doc.getElementById('scrubber').disabled;

  render(doc, { state: st({ phase: 'idle' }), answer: null, genres: [] });
  assert.ok(row(), 'hidden at idle');

  render(doc, { state: st({ phase: 'playing', audioStartTimestamp: Date.now() - 5_000 }), answer: null, genres: [] });
  assert.ok(!row(), 'shown while playing');
  assert.ok(!scrub(), 'enabled while playing');

  render(doc, { state: st({ phase: 'revealed', audioStartTimestamp: Date.now() - 5_000 }), answer: null, genres: [] });
  assert.ok(scrub(), 'disabled once revealed');
});

test('renderClock: writes the elapsed position and readout, honouring pause', () => {
  const doc = makeDoc();
  const now = Date.now();

  renderClock(doc, st({ phase: 'playing', audioStartTimestamp: now - 8_000 }));
  assert.ok(Math.abs(Number(doc.getElementById('scrubber').value) - 8) < 0.5, 'follows the running clock');
  assert.equal(doc.getElementById('time-readout').textContent, '0:08 / 0:30');

  // Paused clips freeze at the pause instant, not the wall clock.
  renderClock(doc, st({ phase: 'playing', audioStartTimestamp: now - 20_000, audioPausedTimestamp: now - 17_000 }));
  assert.ok(Math.abs(Number(doc.getElementById('scrubber').value) - 3) < 0.2, 'frozen at the pause point');
});

test('renderClock: leaves the value alone mid-drag', () => {
  const doc = makeDoc();
  const s = doc.getElementById('scrubber');
  s.value = '4';
  s.dataset.scrubbing = '1';
  renderClock(doc, st({ phase: 'playing', audioStartTimestamp: Date.now() - 12_000 }));
  assert.equal(s.value, '4', 'drag wins over the clock');
});

test('replay button: offered whenever a clip is running, hidden otherwise', () => {
  const doc = makeDoc();
  const hidden = () => doc.getElementById('replay-btn').hasAttribute('hidden');

  render(doc, { state: st({ phase: 'idle' }), answer: null, genres: [] });
  assert.ok(hidden(), 'hidden at idle');

  render(doc, { state: st({ phase: 'playing', audioStartTimestamp: Date.now() - 5_000 }), answer: null, genres: [] });
  assert.ok(!hidden(), 'shown while playing');

  render(doc, { state: st({ phase: 'revealed' }), answer: null, genres: [] });
  assert.ok(hidden(), 'hidden once revealed (replay is invalid there)');
});
