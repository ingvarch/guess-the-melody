// Unit tests for host UI rendering. Uses happy-dom so render() can exercise
// real DOM operations without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

function makeDoc() {
  const win = new Window();
  // Bun compatibility: happy-dom v20 omits Error constructors on Window.
  win.SyntaxError = SyntaxError;
  win.Error = Error;
  const doc = win.document;
  doc.body.innerHTML = `
    <span id="session-code"></span>
    <ul id="teams-list"></ul>
    <form id="add-team-form"></form>
    <select id="genre-select" aria-label="Жанр"></select>
    <button id="spin-btn"></button>
    <div id="phase-controls" hidden>
      <audio id="audio" preload="auto"></audio>
      <button id="play-btn" hidden></button>
      <button id="replay-btn" hidden></button>
      <input id="scrubber" type="range" min="0" max="30" step="0.1" value="0">
      <span id="time-readout">0:00 / 0:30</span>
      <div id="award-area" hidden>
        <ul id="award-teams"></ul>
      </div>
      <button id="reveal-btn" hidden></button>
      <div id="reveal-card" hidden>
        <p class="reveal-card__artist"></p>
        <p class="reveal-card__title"></p>
        <p class="reveal-card__year"></p>
      </div>
      <button id="next-btn" hidden></button>
    </div>
    <div id="mirror-content"></div>
    <input type="radio" name="genre-mode" value="auto" checked>
    <input type="radio" name="genre-mode" value="pick">
  `;
  const audio = doc.getElementById('audio');
  if (audio) {
    audio.play = () => Promise.resolve();
    audio.pause = () => {};
    Object.defineProperty(audio, 'paused', {
      get() { return true; },
      configurable: true,
    });
    Object.defineProperty(audio, 'currentTime', {
      get() { return 0; },
      set() {},
      configurable: true,
    });
  }
  return doc;
}

function makeState(overrides = {}) {
  return {
    phase: 'idle',
    teams: [],
    selectedGenre: null,
    currentTrack: null,
    revealedTrack: null,
    playedTrackIds: [],
    spinSeed: 0,
    audioStartTimestamp: null,
    ...overrides,
  };
}

const mod = await import('../../public/static/js/host-ui.js');
const { render, renderClock } = mod;

test('phase-driven hidden toggling for idle / spinning / playing / revealed', () => {
  const doc = makeDoc();

  // idle
  let view = { state: makeState({ phase: 'idle' }), genres: [], sessionId: 's' };
  render(doc, view);
  assert.equal(doc.getElementById('phase-controls').hasAttribute('hidden'), true);
  assert.equal(doc.getElementById('spin-btn').disabled, false);

  // spinning
  view = {
    state: makeState({ phase: 'spinning', currentTrack: { id: 'x', genre: 'rock' } }),
    genres: [],
    sessionId: 's',
  };
  render(doc, view);
  assert.equal(doc.getElementById('phase-controls').hasAttribute('hidden'), false);
  assert.equal(doc.getElementById('play-btn').hasAttribute('hidden'), false);
  assert.equal(doc.getElementById('spin-btn').disabled, true);

  // playing
  view = {
    state: makeState({
      phase: 'playing',
      currentTrack: { id: 'x', genre: 'rock' },
      audioStartTimestamp: Date.now(),
    }),
    genres: [],
    sessionId: 's',
  };
  render(doc, view);
  assert.equal(doc.getElementById('reveal-btn').hasAttribute('hidden'), false);
  assert.equal(doc.getElementById('award-area').hasAttribute('hidden'), false);

  // revealed
  view = {
    state: makeState({
      phase: 'revealed',
      revealedTrack: { artist: 'A', title: 'T', year: 2000 },
    }),
    genres: [],
    sessionId: 's',
  };
  render(doc, view);
  assert.equal(doc.getElementById('reveal-card').hasAttribute('hidden'), false);
  assert.equal(doc.getElementById('next-btn').hasAttribute('hidden'), false);
});

test('mirror panel never exposes currentTrack identity outside revealed', () => {
  const doc = makeDoc();

  // idle with a currentTrack should not leak identity
  let view = {
    state: makeState({ phase: 'idle', currentTrack: { id: 'x', genre: 'rock' } }),
    genres: [],
    sessionId: 's',
  };
  render(doc, view);
  let mirror = doc.getElementById('mirror-content');
  assert.ok(!mirror.textContent.includes('Secret'));

  // playing
  view = {
    state: makeState({
      phase: 'playing',
      currentTrack: { id: 'x', genre: 'rock' },
      audioStartTimestamp: Date.now(),
    }),
    genres: [],
    sessionId: 's',
  };
  render(doc, view);
  mirror = doc.getElementById('mirror-content');
  assert.ok(!mirror.textContent.includes('Secret'));

  // revealed
  view = {
    state: makeState({
      phase: 'revealed',
      revealedTrack: { artist: 'Secret', title: 'Song', year: 1999 },
    }),
    genres: [],
    sessionId: 's',
  };
  render(doc, view);
  mirror = doc.getElementById('mirror-content');
  assert.ok(mirror.textContent.includes('Secret'));
  assert.ok(mirror.textContent.includes('Song'));
  assert.ok(mirror.textContent.includes('1999'));
});

test('audio src set only when changed', () => {
  const doc = makeDoc();
  const audio = doc.getElementById('audio');
  const calls = [];
  const orig = audio.setAttribute.bind(audio);
  audio.setAttribute = (name, value) => {
    calls.push({ name, value });
    return orig(name, value);
  };

  const view = {
    state: makeState({ currentTrack: { id: 't1', genre: 'rock' } }),
    genres: [],
    sessionId: 'sess1',
  };
  render(doc, view);
  const srcCalls1 = calls.filter((c) => c.name === 'src');
  assert.equal(srcCalls1.length, 1);
  assert.ok(srcCalls1[0].value.includes('t1'));

  // Re-render with same track: no new setAttribute('src', ...) call.
  render(doc, view);
  const srcCalls2 = calls.filter((c) => c.name === 'src');
  assert.equal(srcCalls2.length, 1);

  // New track: another setAttribute call.
  const view2 = {
    state: makeState({ currentTrack: { id: 't2', genre: 'pop' } }),
    genres: [],
    sessionId: 'sess1',
  };
  render(doc, view2);
  const srcCalls3 = calls.filter((c) => c.name === 'src');
  assert.equal(srcCalls3.length, 2);
  assert.ok(srcCalls3[1].value.includes('t2'));
});

test('genre-select preserves current selection across re-renders', () => {
  const doc = makeDoc();
  const view1 = {
    state: makeState(),
    genres: [
      { slug: 'rock', name: 'Rock' },
      { slug: 'pop', name: 'Pop' },
    ],
    sessionId: 's',
  };
  render(doc, view1);
  const select = doc.getElementById('genre-select');
  select.value = 'pop';

  const view2 = {
    state: makeState(),
    genres: [
      { slug: 'rock', name: 'Rock' },
      { slug: 'pop', name: 'Pop' },
      { slug: 'jazz', name: 'Jazz' },
    ],
    sessionId: 's',
  };
  render(doc, view2);
  assert.equal(select.value, 'pop');
});

test('teams-list ordering matches state.teams', () => {
  const doc = makeDoc();
  const teams = [
    { id: 't1', name: 'Alpha', score: 0 },
    { id: 't2', name: 'Beta', score: 5 },
  ];
  const view = { state: makeState({ teams }), genres: [], sessionId: 's' };
  render(doc, view);
  const list = doc.getElementById('teams-list');
  const items = Array.from(list.children);
  assert.deepEqual(
    items.map((li) => li.dataset.teamId),
    ['t1', 't2'],
  );
});

test('re-render with same view produces structurally identical DOM', () => {
  const doc = makeDoc();
  const view = {
    state: makeState({
      teams: [{ id: 't1', name: 'Cats', score: 3 }],
      audioStartTimestamp: Date.now(),
    }),
    genres: [{ slug: 'rock', name: 'Rock' }],
    sessionId: 's',
  };
  render(doc, view);
  const beforeTeams = doc.getElementById('teams-list').innerHTML;
  const beforeMirror = doc.getElementById('mirror-content').innerHTML;
  const beforeGenres = doc.getElementById('genre-select').innerHTML;
  render(doc, view);
  assert.equal(doc.getElementById('teams-list').innerHTML, beforeTeams);
  assert.equal(doc.getElementById('mirror-content').innerHTML, beforeMirror);
  assert.equal(doc.getElementById('genre-select').innerHTML, beforeGenres);
});

test('renderClock updates scrubber and time-readout only', () => {
  const doc = makeDoc();
  const before = doc.body.innerHTML;
  const state = makeState({ phase: 'playing', audioStartTimestamp: Date.now() - 5000 });
  renderClock(doc, state);
  const scrubber = doc.getElementById('scrubber');
  const timeReadout = doc.getElementById('time-readout');
  assert.equal(scrubber.value, '5');
  assert.equal(timeReadout.textContent, '0:05 / 0:30');
  // Other DOM untouched.
  assert.equal(doc.getElementById('session-code').textContent, '');
});
