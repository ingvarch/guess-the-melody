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
    <div id="idle-controls"></div>
    <button id="spin-btn"></button>
    <div id="phase-controls" hidden></div>
    <button id="play-btn" hidden></button>
    <button id="replay-btn" hidden></button>
    <button id="reveal-btn" hidden></button>
    <button id="next-btn" hidden></button>
    <div id="current-track" hidden></div>
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
const { render, runSpin } = mod;

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

test('runSpin bails when the round advances to playing mid-spin', async () => {
  const doc = makeDoc();
  doc.getElementById('display-genre').textContent = 'KEEP';
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
  ];
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop', spinSeed: 3 });
  // getPhase reports 'playing' immediately → runSpin must not touch the headline.
  await runSpin(doc, state, genres, { durationMs: 60, getPhase: () => 'playing' });
  assert.equal(doc.getElementById('display-genre').textContent, 'KEEP');
});

test('runSpin settles display-genre on the selected genre name', async () => {
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
  await runSpin(doc, state, genres, { durationMs: 60 });
  assert.equal(doc.getElementById('display-genre').textContent, 'Pop');
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
