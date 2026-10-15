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
    <div id="jukebox" hidden>
      <div id="genre-drum"><div data-drum-cylinder></div><div data-drum-cylinder></div></div>
      <select id="genre-select"></select>
      <button id="spin-btn"></button>
      <h3 id="jukebox-genre"></h3>
    </div>
    <div id="turntable" hidden><div id="progress-ring"></div></div>
    <div id="phase-controls" hidden></div>
    <button id="play-btn"><span class="material-symbols-outlined">play_arrow</span></button>
    <button id="replay-btn"></button>
    <button id="reveal-btn"></button>
    <button id="next-btn" hidden></button>
    <div id="reveal-card" hidden>
      <p class="reveal-card__artist"></p>
      <p class="reveal-card__title"></p>
      <p class="reveal-card__year"></p>
    </div>
    <audio id="audio" preload="auto"></audio>
    <input id="scrubber" type="range" min="0" max="30" step="0.1" value="0" disabled>
    <span id="time-readout"></span>
    <p id="action-error" hidden></p>
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
const { render, runSpin, renderClock, renderPlaybackControls, showGenreChoice, shouldBeAudible, deckMode, needleAt, paintProgress, showActionError, clearActionError } = mod;

function drumRowTexts(doc) {
  return [...doc.querySelectorAll('[data-drum-cylinder]')].map((c) => [...c.children].map((r) => r.textContent));
}

// The genre the drum shows at the front once it stops.
function drumFrontGenre(doc) {
  const [rows] = drumRowTexts(doc);
  const angle = parseFloat(doc.getElementById('genre-drum').style.getPropertyValue('--spin'));
  const step = 360 / rows.length;
  const row = Math.round((((angle % 360) + 360) % 360) / step) % rows.length;
  return rows[row];
}

const hidden = (doc, id) => doc.getElementById(id).hasAttribute('hidden');

const enabled = (doc, id) => !hidden(doc, id) && !doc.getElementById(id).disabled;
const disabled = (doc, id) => !hidden(doc, id) && doc.getElementById(id).disabled;

test('before Play: the three keys are on screen, only Play works', () => {
  const doc = makeDoc();
  render(doc, { state: makeState({ phase: 'spinning', selectedGenre: 'rock', currentTrack: { id: 'x', genre: 'rock' } }), genres: [], sessionId: 's' });
  assert.ok(enabled(doc, 'play-btn'));
  assert.ok(disabled(doc, 'replay-btn'), 'replay is only valid while playing');
  assert.ok(disabled(doc, 'reveal-btn'), 'reveal is only valid while playing');
});

test('playing: Reveal and start-over work while the music runs, Play shows Pause', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: Date.now() - 5_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  const btn = doc.getElementById('play-btn');
  assert.ok(enabled(doc, 'play-btn'));
  assert.equal(btn.querySelector('.material-symbols-outlined').textContent, 'pause');
  assert.equal(btn.getAttribute('aria-label'), 'Pause');
  // Like the host console: revealing mid-clip keeps the music going.
  assert.ok(enabled(doc, 'reveal-btn'));
  assert.ok(enabled(doc, 'replay-btn'));
  assert.ok(hidden(doc, 'next-btn'), 'next lives in the reveal card');
});

test('playing and paused: Play resumes', () => {
  const doc = makeDoc();
  const now = Date.now();
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: now - 5_000,
    audioPausedTimestamp: now - 1_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  const btn = doc.getElementById('play-btn');
  assert.ok(enabled(doc, 'play-btn'));
  assert.equal(btn.querySelector('.material-symbols-outlined').textContent, 'play_arrow');
  assert.equal(btn.getAttribute('aria-label'), 'Play');
  assert.ok(enabled(doc, 'reveal-btn'));
  assert.ok(enabled(doc, 'replay-btn'));
});

test('playing and clip ended: nothing left to play or pause, start-over and Reveal still work', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: Date.now() - 31_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.ok(disabled(doc, 'play-btn'));
  assert.ok(enabled(doc, 'reveal-btn'));
  assert.ok(enabled(doc, 'replay-btn'));
});

test('revealed: next shown, the keys rest', () => {
  const doc = makeDoc();
  const state = makeState({
    phase: 'revealed',
    currentTrack: { id: 'x', genre: 'rock' },
    revealedTrack: { artist: 'A', title: 'T', year: 2000 },
    audioStartTimestamp: Date.now() - 31_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.ok(!hidden(doc, 'next-btn'), 'next shown when revealed');
  assert.ok(disabled(doc, 'reveal-btn'));
  // The `replay` transition is only valid from `playing`.
  assert.ok(disabled(doc, 'replay-btn'));
  assert.ok(disabled(doc, 'play-btn'));
});

test('runSpin bails when the round advances to playing mid-spin', async () => {
  const doc = makeDoc();
  doc.getElementById('display-genre').textContent = 'KEEP';
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
  ];
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop', spinSeed: 3 });
  // getPhase reports 'playing' immediately → runSpin must not start at all.
  await runSpin(doc, state, genres, { durationMs: 60, settleMs: 10, getPhase: () => 'playing' });
  assert.equal(doc.getElementById('display-genre').textContent, 'KEEP');
  assert.ok(!doc.getElementById('genre-drum').classList.contains('genre-drum--landed'));
});

test('render: once the drum has stopped, the spinning screen names the genre', () => {
  const genres = [{ slug: 'russian-rock', name: 'Русский рок' }];
  for (const genrePicked of [false, true]) {
    const doc = makeDoc();
    render(doc, { state: makeState({ phase: 'spinning', selectedGenre: 'russian-rock', genrePicked }), genres, sessionId: 's' });
    assert.equal(doc.getElementById('display-genre').textContent, 'Русский рок');
  }
});

test('render: while the drum picks, the headline is left to runSpin', () => {
  const doc = makeDoc();
  doc.getElementById('display-genre').textContent = 'KEEP';
  const genres = [{ slug: 'pop', name: 'Pop' }];
  render(doc, { state: makeState({ phase: 'spinning', selectedGenre: 'pop' }), genres, sessionId: 's', picking: true });
  assert.equal(doc.getElementById('display-genre').textContent, 'KEEP');
  assert.equal(doc.getElementById('phase-label').textContent, 'ROUND 1');
});

test('runSpin: the headline says "Picking Genre..." until the drum stops on the genre', async () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }, { slug: 'pop', name: 'Pop' }];
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop', spinSeed: 7 });
  const spinning = runSpin(doc, state, genres, { durationMs: 40, settleMs: 0 });
  assert.equal(doc.getElementById('display-genre').textContent, 'Picking Genre...');
  await spinning;
  assert.equal(doc.getElementById('display-genre').textContent, 'Pop');
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
  assert.equal(doc.getElementById('jukebox-genre').textContent, 'Jazz');
  assert.equal(doc.getElementById('display-genre').textContent, 'Jazz');
});

test('runSpin spins the jukebox drum and names the genre it stops on', async () => {
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
  // Screen readers hear the genre; the headline keeps it for the Play screen.
  assert.equal(doc.getElementById('jukebox-genre').textContent, 'Pop');
  assert.equal(doc.getElementById('display-genre').textContent, 'Pop');
});

test('runSpin pulls the lever for everyone watching', async () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }, { slug: 'pop', name: 'Pop' }];
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop', spinSeed: 7 });
  await runSpin(doc, state, genres, { durationMs: 20, settleMs: 0 });
  assert.ok(doc.getElementById('spin-btn').classList.contains('lever--pulling'));
});

test('runSpin starts from where the idle drum stands and still spins several turns', async () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }, { slug: 'pop', name: 'Pop' }, { slug: 'jazz', name: 'Jazz' }];
  const drum = doc.getElementById('genre-drum');
  drum.style.setProperty('--spin', '1000deg');
  const state = makeState({ phase: 'spinning', selectedGenre: 'jazz', spinSeed: 2 });
  await runSpin(doc, state, genres, { durationMs: 20, settleMs: 0 });
  const angle = parseFloat(drum.style.getPropertyValue('--spin'));
  assert.ok(angle - 1000 >= 4 * 360, `turned only ${angle - 1000}deg`);
  assert.equal(drumFrontGenre(doc), 'Jazz');
});

test('runSpin ends the hold on the genre as soon as the round moves on', async () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }, { slug: 'pop', name: 'Pop' }];
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop', spinSeed: 7 });
  const startedAt = Date.now();
  const getPhase = () => (Date.now() - startedAt < 80 ? 'spinning' : 'playing');
  // settleMs is far beyond the test timeout: only an early return lets this finish.
  await runSpin(doc, state, genres, { durationMs: 20, settleMs: 100000, getPhase });
  assert.equal(drumFrontGenre(doc), 'Pop');
});

test('runSpin builds the drum from the genre list and stops it on the picked genre', async () => {
  const doc = makeDoc();
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
    { slug: 'jazz', name: 'Jazz' },
  ];
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop', spinSeed: 7 });
  // Two rounds on the same page: the drum is reused, rows must not pile up.
  await runSpin(doc, state, genres, { durationMs: 20, settleMs: 0 });
  await runSpin(doc, state, genres, { durationMs: 20, settleMs: 0 });

  const [muted, lens] = drumRowTexts(doc);
  assert.ok(muted.length >= 20 && muted.length % genres.length === 0, `rows: ${muted.length}`);
  muted.forEach((name, i) => assert.equal(name, genres[i % genres.length].name));
  assert.deepEqual(lens, muted, 'the highlight layer carries the same rows');
  assert.equal(drumFrontGenre(doc), 'Pop');
  assert.ok(doc.getElementById('genre-drum').classList.contains('genre-drum--landed'), 'center row lights up once stopped');
});

test('runSpin stops on the slug when the picked genre is missing from the list', async () => {
  const doc = makeDoc();
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
  ];
  const state = makeState({ phase: 'spinning', selectedGenre: 'russian-rock', spinSeed: 5 });
  await runSpin(doc, state, genres, { durationMs: 20, settleMs: 0 });
  assert.equal(drumFrontGenre(doc), 'russian-rock');
  assert.equal(doc.getElementById('display-genre').textContent, 'russian-rock');
});

test('runSpin in genrePicked mode turns the drum the short way to the chosen genre', async () => {
  const doc = makeDoc();
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
    { slug: 'jazz', name: 'Jazz' },
  ];
  const drum = doc.getElementById('genre-drum');
  drum.style.setProperty('--spin', '500deg');
  const state = makeState({ phase: 'spinning', selectedGenre: 'jazz', genrePicked: true, spinSeed: 7 });
  await runSpin(doc, state, genres, { durationMs: 100000, confirmMs: 10, getPhase: () => 'spinning' });

  assert.equal(drumFrontGenre(doc), 'Jazz');
  const [rows] = drumRowTexts(doc);
  const turned = Math.abs(parseFloat(drum.style.getPropertyValue('--spin')) - 500);
  assert.ok(turned <= (360 * genres.length) / rows.length / 2, `no fake draw: turned ${turned}deg`);
  assert.ok(drum.classList.contains('genre-drum--landed'));
});

test('runSpin stops early when the round moves to playing mid-spin', async () => {
  const doc = makeDoc();
  doc.getElementById('display-genre').textContent = 'KEEP';
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
  ];
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop', spinSeed: 3 });
  const startedAt = Date.now();
  const getPhase = () => (Date.now() - startedAt < 50 ? 'spinning' : 'playing');
  // durationMs is far beyond the test timeout: only an early stop lets this finish.
  await runSpin(doc, state, genres, { durationMs: 100000, settleMs: 100000, getPhase });
  assert.notEqual(doc.getElementById('display-genre').textContent, 'Pop', 'no landing announced');
  assert.ok(!doc.getElementById('genre-drum').classList.contains('genre-drum--landed'));
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

test('render: idle shows the jukebox, not the record or the playback panel', () => {
  const doc = makeDoc();
  render(doc, { state: makeState({ phase: 'idle' }), genres: [], sessionId: 's' });
  assert.ok(!hidden(doc, 'jukebox'));
  assert.ok(hidden(doc, 'turntable'));
  assert.ok(hidden(doc, 'phase-controls'));
  assert.equal(doc.getElementById('spin-btn').disabled, false);
});

test('render: while the drum picks a genre the jukebox stays up and the Play screen waits', () => {
  const doc = makeDoc();
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop' });
  render(doc, { state, genres: [], sessionId: 's', picking: true });
  assert.ok(!hidden(doc, 'jukebox'));
  assert.ok(hidden(doc, 'turntable'));
  assert.ok(hidden(doc, 'phase-controls'));
  assert.equal(doc.getElementById('spin-btn').disabled, true, 'no second pull mid-spin');

  render(doc, { state, genres: [], sessionId: 's', picking: false });
  assert.ok(hidden(doc, 'jukebox'));
  assert.ok(!hidden(doc, 'turntable'));
  assert.ok(!hidden(doc, 'phase-controls'));
});

test('renderPlaybackControls: the clock tick keeps the jukebox up while the drum picks', () => {
  const doc = makeDoc();
  const state = makeState({ phase: 'spinning', selectedGenre: 'pop' });
  renderPlaybackControls(doc, state, true);
  assert.ok(!hidden(doc, 'jukebox'));
  assert.ok(hidden(doc, 'phase-controls'));
  renderPlaybackControls(doc, state, false);
  assert.ok(hidden(doc, 'jukebox'));
  assert.ok(!hidden(doc, 'phase-controls'));
});

test('render: the idle drum carries the genres and drifts while the genre is left to chance', () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }, { slug: 'pop', name: 'Pop' }];
  render(doc, { state: makeState({ phase: 'idle' }), genres, sessionId: 's' });
  const drum = doc.getElementById('genre-drum');
  const [rows] = drumRowTexts(doc);
  assert.ok(rows.length >= 20);
  assert.ok(drum.classList.contains('genre-drum--idle'));
  assert.ok(!drum.classList.contains('genre-drum--landed'));
});

test('showGenreChoice: picking a genre in the selector stops the drift and turns the drum to it', () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }, { slug: 'pop', name: 'Pop' }, { slug: 'jazz', name: 'Jazz' }];
  render(doc, { state: makeState({ phase: 'idle' }), genres, sessionId: 's' });
  doc.getElementById('genre-select').value = 'jazz';
  showGenreChoice(doc, genres);
  const drum = doc.getElementById('genre-drum');
  assert.equal(drumFrontGenre(doc), 'Jazz');
  assert.ok(drum.classList.contains('genre-drum--landed'));
  assert.ok(!drum.classList.contains('genre-drum--idle'));

  doc.getElementById('genre-select').value = '';
  showGenreChoice(doc, genres);
  assert.ok(drum.classList.contains('genre-drum--idle'), 'back to Auto: drifting again');
  assert.ok(!drum.classList.contains('genre-drum--landed'));
});

test('render: re-rendering at idle keeps the drum on the picked genre', () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }, { slug: 'pop', name: 'Pop' }];
  const view = { state: makeState({ phase: 'idle' }), genres, sessionId: 's' };
  render(doc, view);
  doc.getElementById('genre-select').value = 'pop';
  showGenreChoice(doc, genres);
  const angle = doc.getElementById('genre-drum').style.getPropertyValue('--spin');
  render(doc, view);
  assert.equal(doc.getElementById('genre-drum').style.getPropertyValue('--spin'), angle);
  assert.equal(drumFrontGenre(doc), 'Pop');
});

test('render: the turntable stays hidden while idle and shows once a round starts', () => {
  const doc = makeDoc();
  render(doc, { state: makeState({ phase: 'idle' }), genres: [], sessionId: 's' });
  assert.ok(hidden(doc, 'turntable'));
  render(doc, { state: makeState({ phase: 'spinning', selectedGenre: 'pop' }), genres: [], sessionId: 's' });
  assert.ok(!hidden(doc, 'turntable'));
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

test('shouldBeAudible: true while playing, unpaused, clip not ended', () => {
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

test('shouldBeAudible: a clip revealed mid-play keeps sounding until it ends', () => {
  assert.equal(shouldBeAudible(makeState({
    phase: 'revealed',
    audioStartTimestamp: Date.now() - 5_000,
  })), true);
  assert.equal(shouldBeAudible(makeState({
    phase: 'revealed',
    audioStartTimestamp: Date.now() - 5_000,
    audioPausedTimestamp: Date.now() - 1_000,
  })), false, 'paused before the reveal: stays silent');
  assert.equal(shouldBeAudible(makeState({
    phase: 'revealed',
    audioStartTimestamp: Date.now() - 31_000,
  })), false, 'clip already ran out');
});

function trackPauses(doc) {
  const audio = doc.getElementById('audio');
  const calls = { pauses: 0 };
  audio.pause = () => { calls.pauses += 1; };
  Object.defineProperty(audio, 'paused', { get() { return false; }, configurable: true });
  return calls;
}

test('render: revealing mid-clip leaves the audio running', () => {
  const doc = makeDoc();
  const calls = trackPauses(doc);
  const state = makeState({
    phase: 'revealed',
    currentTrack: { id: 'x', genre: 'rock' },
    revealedTrack: { artist: 'A', title: 'T', year: 2000 },
    audioStartTimestamp: Date.now() - 5_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.equal(calls.pauses, 0);
});

test('render: a clip paused before the reveal stays paused', () => {
  const doc = makeDoc();
  const calls = trackPauses(doc);
  const state = makeState({
    phase: 'revealed',
    currentTrack: { id: 'x', genre: 'rock' },
    revealedTrack: { artist: 'A', title: 'T', year: 2000 },
    audioStartTimestamp: Date.now() - 5_000,
    audioPausedTimestamp: Date.now() - 1_000,
  });
  render(doc, { state, genres: [], sessionId: 's' });
  assert.equal(calls.pauses, 1);
});

test('renderClock: keeps the audio aligned with the shared clock after the reveal', () => {
  const doc = makeDoc();
  const audio = doc.getElementById('audio');
  let seeked = null;
  Object.defineProperty(audio, 'currentTime', { get() { return 0; }, set(v) { seeked = v; }, configurable: true });
  renderClock(doc, makeState({ phase: 'revealed', audioStartTimestamp: Date.now() - 5_000 }));
  assert.ok(seeked !== null && Math.abs(seeked - 5) < 1, `seeked to ${seeked}`);
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

test('scrubber: enabled only while the clip phase is playing', () => {
  const doc = makeDoc();
  render(doc, { state: makeState({ phase: 'idle' }), genres: [], sessionId: 's' });
  assert.ok(doc.getElementById('scrubber').disabled, 'disabled while idle');

  const playing = makeState({
    phase: 'playing',
    currentTrack: { id: 'x', genre: 'rock' },
    audioStartTimestamp: Date.now() - 5_000,
  });
  render(doc, { state: playing, genres: [], sessionId: 's' });
  assert.ok(!doc.getElementById('scrubber').disabled, 'enabled while playing');

  render(doc, { state: makeState({ phase: 'revealed' }), genres: [], sessionId: 's' });
  assert.ok(doc.getElementById('scrubber').disabled, 'disabled after reveal');
});

test('shouldBeAudible: silent while the jukebox puts the record on', () => {
  const cueing = makeState({ phase: 'playing', audioStartTimestamp: Date.now() + 1_500 });
  assert.equal(shouldBeAudible(cueing), false);
  const started = makeState({ phase: 'playing', audioStartTimestamp: Date.now() - 100 });
  assert.equal(shouldBeAudible(started), true);
});

test('deckMode: plays from the Play press, holds the needle up on pause, stops at the clip end', () => {
  const now = Date.now();
  assert.equal(deckMode(makeState({ phase: 'playing', audioStartTimestamp: now + 1_500 })), 'play', 'record cue');
  assert.equal(deckMode(makeState({ phase: 'playing', audioStartTimestamp: now - 5_000 })), 'play', 'music');
  assert.equal(deckMode(makeState({
    phase: 'playing', audioStartTimestamp: now - 5_000, audioPausedTimestamp: now - 1_000,
  })), 'cue', 'paused: the record keeps turning under the raised needle');
  assert.equal(deckMode(makeState({ phase: 'playing', audioStartTimestamp: now - 31_000 })), 'stop', 'ended');
  assert.equal(deckMode(makeState({ phase: 'spinning' })), 'stop', 'before Play');
});

test('needleAt: in the groove while the music sounds, lifted on pause, elsewhere otherwise', () => {
  const now = Date.now();
  assert.equal(needleAt(makeState({ phase: 'playing', audioStartTimestamp: now - 5_000 })), 'groove');
  assert.equal(needleAt(makeState({ phase: 'revealed', audioStartTimestamp: now - 5_000 })), 'groove', 'the music outlives the reveal');
  assert.equal(needleAt(makeState({
    phase: 'playing', audioStartTimestamp: now - 5_000, audioPausedTimestamp: now - 1_000,
  })), 'lifted');
  assert.equal(needleAt(makeState({ phase: 'playing', audioStartTimestamp: now + 1_500 })), 'away', 'still on its way during the record cue');
  assert.equal(needleAt(makeState({ phase: 'playing', audioStartTimestamp: now - 31_000 })), 'away', 'ended');
  assert.equal(needleAt(makeState({ phase: 'idle' })), 'away');
});

test('renderClock: lights the ring around the record up to the clip position', () => {
  const doc = makeDoc();
  renderClock(doc, makeState({ phase: 'playing', audioStartTimestamp: Date.now() - 15_000 }));
  const progress = Number(doc.getElementById('progress-ring').style.getPropertyValue('--progress'));
  assert.ok(Math.abs(progress - 0.5) < 0.02, `progress ${progress}`);
});

test('paintProgress: mid-drag the ring follows the finger', () => {
  const doc = makeDoc();
  doc.getElementById('scrubber').value = '6';
  paintProgress(doc);
  assert.equal(Number(doc.getElementById('progress-ring').style.getPropertyValue('--progress')), 0.2);
});

test('renderClock: leaves the scrubber value alone mid-drag', () => {
  const doc = makeDoc();
  const scrub = doc.getElementById('scrubber');
  const state = makeState({
    phase: 'playing',
    audioStartTimestamp: Date.now() - 10_000,
  });

  scrub.value = '3';
  scrub.dataset.scrubbing = '1';
  renderClock(doc, state);
  assert.equal(scrub.value, '3', 'drag in progress: value untouched');

  delete scrub.dataset.scrubbing;
  renderClock(doc, state);
  assert.ok(Math.abs(Number(scrub.value) - 10) < 1, 'drag released: value follows the clock');
});

test('showActionError: a 403 is explained, not swallowed', () => {
  const doc = makeDoc();
  showActionError(doc, new Error('action seek failed: 403 forbidden'));
  const el = doc.getElementById('action-error');
  assert.ok(!el.hasAttribute('hidden'), 'error surface becomes visible');
  assert.match(el.textContent, /host console/i, 'tells the host where the controls live');
});

test('showActionError: other failures show the raw message', () => {
  const doc = makeDoc();
  showActionError(doc, new Error('action seek failed: 409 invalid transition'));
  assert.match(doc.getElementById('action-error').textContent, /409/);
});

test('clearActionError: hides the surface again', () => {
  const doc = makeDoc();
  showActionError(doc, new Error('boom'));
  clearActionError(doc);
  assert.ok(doc.getElementById('action-error').hasAttribute('hidden'));
});
