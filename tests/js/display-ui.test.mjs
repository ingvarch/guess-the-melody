// Unit tests for display UI renderer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

function makeDoc() {
  const win = new Window();
  win.SyntaxError = SyntaxError;
  win.Error = Error;
  const doc = win.document;
  doc.body.innerHTML = `
    <ul id="scoreboard-list"></ul>
    <p id="phase-label"></p>
    <h2 id="display-genre"></h2>
    <div id="spin-card" hidden><h3 id="spin-card-genre"></h3></div>
    <div id="idle-controls"></div>
    <button id="spin-btn"></button>
    <div id="phase-controls" hidden></div>
    <button id="play-btn" hidden><span class="material-symbols-outlined">play_arrow</span></button>
    <button id="replay-btn" hidden></button>
    <button id="reveal-btn" hidden></button>
    <button id="next-btn" hidden></button>
    <div id="reveal-card" hidden>
      <p class="reveal-card__artist"></p>
      <p class="reveal-card__title"></p>
      <p class="reveal-card__year"></p>
    </div>
    <audio id="audio" preload="auto"></audio>
  `;
  const audio = doc.getElementById('audio');
  if (audio) {
    audio.play = () => Promise.resolve();
    audio.pause = () => {};
    Object.defineProperty(audio, 'paused', { get() { return true; }, configurable: true });
    Object.defineProperty(audio, 'currentTime', { get() { return 0; }, set() {}, configurable: true });
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

const mod = await import('../../public/static/js/display-ui.js');
const { render, runSpin, shouldBeAudible } = mod;

const hidden = (doc, id) => doc.getElementById(id).hasAttribute('hidden');

test('playing but clip not ended: reveal + repeat hidden', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: Date.now() - 5_000, // 5s in
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.ok(hidden(doc, 'reveal-btn'), 'reveal hidden mid-clip');
  assert.ok(hidden(doc, 'replay-btn'), 'repeat hidden mid-clip');
  assert.ok(hidden(doc, 'next-btn'), 'next hidden mid-clip');
});

test('playing and clip ended: reveal + repeat shown, next still hidden', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: Date.now() - 31_000, // past 30s clip
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.ok(!hidden(doc, 'reveal-btn'), 'reveal shown after clip end');
  assert.ok(!hidden(doc, 'replay-btn'), 'repeat shown after clip end');
  assert.ok(hidden(doc, 'next-btn'), 'next still hidden before reveal');
});

test('playing and running: play-btn shows as a Pause control', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: Date.now() - 5_000,
    audioPausedTimestamp: null,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  const btn = doc.getElementById('play-btn');
  assert.ok(!hidden(doc, 'play-btn'), 'play/pause button visible while playing');
  assert.equal(btn.querySelector('.material-symbols-outlined').textContent, 'pause');
  assert.equal(btn.getAttribute('aria-label'), 'Pause');
});

test('playing and paused: Play (resume) + Reveal shown so the host can reveal early', () => {
  const doc = makeDoc();
  const now = Date.now();
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: now - 5_000,
    audioPausedTimestamp: now - 1_000, // paused 4s in
  });
  render(doc, { state, genres: [], sessionId: 's' });
  const btn = doc.getElementById('play-btn');
  assert.ok(!hidden(doc, 'play-btn'), 'resume button visible while paused');
  assert.equal(btn.querySelector('.material-symbols-outlined').textContent, 'play_arrow');
  // Pausing means someone guessed early -> let the host reveal without waiting.
  assert.ok(!hidden(doc, 'reveal-btn'), 'reveal shown while paused mid-clip');
  // Replay stays clip-end-only (no point restarting a paused-mid clip).
  assert.ok(hidden(doc, 'replay-btn'), 'replay hidden while paused mid-clip');
});

test('playing and clip ended: play/pause button is hidden', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: Date.now() - 31_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.ok(hidden(doc, 'play-btn'), 'no play/pause once the clip has ended');
});

test('revealed: next shown, reveal + repeat hidden', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'revealed',
    currentTrack: { id: 'x', genre: 'rock' },
    revealedTrack: { artist: 'A', title: 'T', year: 2000 },
    audioStartTimestamp: Date.now() - 31_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.ok(!hidden(doc, 'next-btn'), 'next shown when revealed');
  assert.ok(hidden(doc, 'reveal-btn'), 'reveal hidden when revealed');
  // Repeat must be hidden: the `replay` transition is only valid from `playing`.
  assert.ok(hidden(doc, 'replay-btn'), 'repeat hidden when revealed (replay invalid here)');
});

test('runSpin bails (and leaves the overlay hidden) when the round advances to playing mid-spin', async () => {
  const doc = makeDoc();
  doc.getElementById('display-genre').textContent = 'KEEP';
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
  ];
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop', spinSeed: 3 });
  // getPhase reports 'playing' immediately → runSpin must not touch the headline.
  await runSpin(doc, state, genres, { durationMs: 60, settleMs: 10, getPhase: () => 'playing' });
  assert.equal(doc.getElementById('display-genre').textContent, 'KEEP');
  assert.equal(doc.getElementById('spin-card').hasAttribute('hidden'), true, 'overlay hidden after bail');
});

test('render: spinning headline says "Picking Genre..." only for auto spin', () => {
  const genres = [{ slug: 'russian-rock', name: 'Русский рок' }];
  const auto = makeDoc();
  render(auto, { state: makeState({ phase: 'spinning', selectedGenre: 'russian-rock', genrePicked: false }), genres, sessionId: 's' });
  assert.equal(auto.getElementById('display-genre').textContent, 'Picking Genre...');

  const picked = makeDoc();
  render(picked, { state: makeState({ phase: 'spinning', selectedGenre: 'russian-rock', genrePicked: true }), genres, sessionId: 's' });
  assert.equal(picked.getElementById('display-genre').textContent, 'Русский рок');
});

test('render: playing/revealed headline shows the genre name, not the slug', () => {
  const genres = [{ slug: 'russian-rock', name: 'Русский рок' }];

  const playing = makeDoc();
  render(playing, { state: makeState({ phase: 'playing', selectedGenre: 'russian-rock', currentTrack: { id: 'x', genre: 'russian-rock' }, audioStartTimestamp: Date.now() }), genres, sessionId: 's' });
  assert.equal(playing.getElementById('display-genre').textContent, 'Русский рок');

  const revealed = makeDoc();
  render(revealed, { state: makeState({ phase: 'revealed', selectedGenre: 'russian-rock', revealedTrack: { artist: 'A', title: 'T', year: 2000 } }), genres, sessionId: 's' });
  assert.equal(revealed.getElementById('display-genre').textContent, 'Русский рок');
});

test('render: genre headline falls back to the slug when name is unknown', () => {
  const playing = makeDoc();
  render(playing, { state: makeState({ phase: 'playing', selectedGenre: 'russian-rock', currentTrack: { id: 'x', genre: 'russian-rock' }, audioStartTimestamp: Date.now() }), genres: [], sessionId: 's' });
  assert.equal(playing.getElementById('display-genre').textContent, 'russian-rock');
});

test('runSpin in genrePicked mode confirms the chosen genre without cycling', async () => {
  const doc = makeDoc();
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
    { slug: 'jazz', name: 'Jazz' },
  ];
  const state = makeState({
    phase: 'spinning',
    selectedGenre: 'jazz',
    genrePicked: true,
    spinSeed: 7,
    currentTrack: { id: 'x', genre: 'jazz' },
  });
  // durationMs huge: the cycling path would take ~100s and hang the test.
  // The confirm path ignores it and returns after confirmMs → proves no cycling.
  await runSpin(doc, state, genres, {
    durationMs: 100000,
    settleMs: 100000,
    confirmMs: 10,
    getPhase: () => 'spinning',
  });
  assert.equal(doc.getElementById('spin-card-genre').textContent, 'Jazz');
  assert.equal(doc.getElementById('display-genre').textContent, 'Jazz');
  assert.equal(doc.getElementById('spin-card').hasAttribute('hidden'), true, 'overlay closes when done');
});

test('runSpin animates the overlay, settles on the genre, then hides the overlay', async () => {
  const doc = makeDoc();
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
    { slug: 'jazz', name: 'Jazz' },
  ];
  const state = makeState({
    phase: 'spinning',
    selectedGenre: 'pop',
    spinSeed: 7,
    currentTrack: { id: 'x', genre: 'pop' },
  });
  await runSpin(doc, state, genres, { durationMs: 60, settleMs: 10 });
  // Final genre lands in the overlay card AND the underlying headline (so the
  // normal spinning screen shows it once the overlay closes).
  assert.equal(doc.getElementById('spin-card-genre').textContent, 'Pop');
  assert.equal(doc.getElementById('display-genre').textContent, 'Pop');
  assert.equal(doc.getElementById('spin-card').hasAttribute('hidden'), true, 'overlay closes when done');
});

test('scoreboard renders teams in order', () => {
  const doc = makeDoc();
  const view = {
    state: makeState({ teams: [
      { id: 't1', name: 'Alpha', score: 3 },
      { id: 't2', name: 'Beta', score: 7 },
    ] }),
    genres: [],
    sessionId: 's',
  };
  render(doc, view);
  const items = doc.querySelectorAll('.scoreboard__item');
  assert.equal(items.length, 2);
  assert.ok(items[0].textContent.includes('Alpha'));
  assert.ok(items[0].querySelector('.scoreboard__score').textContent.includes('3'));
});

test('reveal card hidden outside revealed', () => {
  const doc = makeDoc();
  render(doc, { state: makeState({ phase: 'idle' }), genres: [], sessionId: 's' });
  assert.ok(doc.getElementById('reveal-card').hasAttribute('hidden'));
  render(doc, { state: makeState({ phase: 'playing' }), genres: [], sessionId: 's' });
  assert.ok(doc.getElementById('reveal-card').hasAttribute('hidden'));
});

test('reveal card shows track info when revealed', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'revealed',
    revealedTrack: { artist: 'Queen', title: 'Bohemian Rhapsody', year: 1975 },
  });
  render(doc, { state, genres: [], sessionId: 's' });
  const card = doc.getElementById('reveal-card');
  assert.ok(!card.hasAttribute('hidden'));
  assert.equal(card.querySelector('.reveal-card__artist').textContent, 'Queen');
  assert.equal(card.querySelector('.reveal-card__title').textContent, 'Bohemian Rhapsody');
  assert.equal(card.querySelector('.reveal-card__year').textContent, '1975');
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
    state: makeState({ currentTrack: { id: 'tr1', genre: 'rock' } }),
    genres: [],
    sessionId: 'sess1',
  };
  render(doc, view);
  const srcCalls = calls.filter((c) => c.name === 'src');
  assert.equal(srcCalls.length, 1);
  assert.ok(srcCalls[0].value.includes('tr1'));
});

test('shouldBeAudible: true only while playing, unpaused, clip not ended', () => {
  assert.equal(shouldBeAudible(makeState({
    phase: 'playing',
    audioStartTimestamp: Date.now() - 5_000,
  })), true);
  assert.equal(shouldBeAudible(makeState({ phase: 'idle' })), false);
  assert.equal(shouldBeAudible(makeState({
    phase: 'playing',
    audioStartTimestamp: Date.now() - 5_000,
    audioPausedTimestamp: Date.now() - 1_000,
  })), false);
  assert.equal(shouldBeAudible(makeState({
    phase: 'playing',
    audioStartTimestamp: Date.now() - 31_000, // past the 30s clip
  })), false);
  assert.equal(shouldBeAudible(makeState({ phase: 'revealed' })), false);
});

test('render never calls audio.play directly (the sound gate owns starting)', () => {
  const doc = makeDoc();
  let plays = 0;
  const audio = doc.getElementById('audio');
  audio.play = () => { plays += 1; return Promise.resolve(); };
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: Date.now() - 5_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.equal(plays, 0);
});
