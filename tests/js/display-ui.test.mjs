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
    <div id="shelves"></div>
    <ul id="scoreboard-list"></ul>
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
const { render } = mod;

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

test('shelves built once when genres provided', () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }];
  render(doc, { state: makeState(), genres, sessionId: 's' });
  assert.equal(doc.querySelectorAll('.shelf').length, 1);
  // Second render with empty genres should keep shelves.
  render(doc, { state: makeState(), genres: [], sessionId: 's' });
  assert.equal(doc.querySelectorAll('.shelf').length, 1);
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
