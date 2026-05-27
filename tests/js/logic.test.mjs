import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../../public/static/js/logic.js';
import { initialState, addTeam } from '../../public/static/js/state.js';

test('spin: idle -> spinning, fills currentTrack and spinSeed', () => {
  const s = initialState();
  const out = applyAction(s, {
    action: 'spin',
    selectedGenre: 'rock',
    trackId: 'abc',
    spinSeed: 42,
  });
  assert.equal(out.phase, 'spinning');
  assert.equal(out.selectedGenre, 'rock');
  assert.deepEqual(out.currentTrack, { id: 'abc', genre: 'rock' });
  assert.equal(out.spinSeed, 42);
});

test('spin: invalid from non-idle', () => {
  const s = { ...initialState(), phase: 'playing' };
  assert.throws(() => applyAction(s, {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 42,
  }));
});

test('play: spinning -> playing, sets audioStartTimestamp', () => {
  const s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  const out = applyAction(s, { action: 'play', now: 1234567890 });
  assert.equal(out.phase, 'playing');
  assert.equal(out.audioStartTimestamp, 1234567890);
});

test('reveal: playing -> revealed, stores revealedTrack', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = applyAction(s, { action: 'play', now: 1 });
  const out = applyAction(s, {
    action: 'reveal',
    track: { artist: 'A', title: 'T', year: 2020 },
  });
  assert.equal(out.phase, 'revealed');
  assert.deepEqual(out.revealedTrack, { artist: 'A', title: 'T', year: 2020 });
});

test('next: revealed -> idle, dedupes track', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = applyAction(s, { action: 'play', now: 1 });
  s = applyAction(s, { action: 'reveal', track: { artist: 'A', title: 'T', year: 2020 } });
  const out = applyAction(s, { action: 'next' });
  assert.equal(out.phase, 'idle');
  assert.deepEqual(out.playedTrackIds, ['abc']);
  assert.equal(out.currentTrack, null);
  assert.equal(out.revealedTrack, null);
  assert.equal(out.selectedGenre, null);
  assert.equal(out.spinSeed, 0);
  assert.equal(out.audioStartTimestamp, null);
});

test('next: playing -> idle is allowed (skip without reveal)', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = applyAction(s, { action: 'play', now: 1 });
  const out = applyAction(s, { action: 'next' });
  assert.equal(out.phase, 'idle');
  assert.deepEqual(out.playedTrackIds, ['abc']);
});

test('award: allowed in playing and revealed', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = addTeam(s, { id: 't1', name: 'Cats' });
  s = applyAction(s, { action: 'play', now: 1 });
  let out = applyAction(s, { action: 'award', teamId: 't1', points: 2 });
  assert.equal(out.teams[0].score, 2);
  out = applyAction(out, {
    action: 'reveal', track: { artist: 'A', title: 'T', year: 2020 },
  });
  out = applyAction(out, { action: 'award', teamId: 't1', points: 1 });
  assert.equal(out.teams[0].score, 3);
});

test('award: rejected in idle and spinning', () => {
  let s = addTeam(initialState(), { id: 't1', name: 'Cats' });
  assert.throws(() => applyAction(s, { action: 'award', teamId: 't1', points: 1 }));
  s = applyAction(s, { action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1 });
  assert.throws(() => applyAction(s, { action: 'award', teamId: 't1', points: 1 }));
});

test('team CRUD: allowed in any phase', () => {
  let s = initialState();
  s = applyAction(s, { action: 'team.add', id: 't1', name: 'A' });
  s = applyAction(s, { action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1 });
  s = applyAction(s, { action: 'team.add', id: 't2', name: 'B' });
  s = applyAction(s, { action: 'team.rename', id: 't2', name: 'Bee' });
  s = applyAction(s, { action: 'team.remove', id: 't1' });
  assert.equal(s.teams.length, 1);
  assert.equal(s.teams[0].name, 'Bee');
});

test('endgame: hard reset, optionally keeping scores', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 1,
  });
  s = addTeam(s, { id: 't1', name: 'Cats' });
  s = applyAction(s, { action: 'play', now: 1 });
  s = applyAction(s, { action: 'award', teamId: 't1', points: 2 });

  const out1 = applyAction(s, { action: 'endgame', resetScores: false });
  assert.equal(out1.phase, 'idle');
  assert.equal(out1.teams[0].score, 2);
  assert.deepEqual(out1.playedTrackIds, []);

  const out2 = applyAction(s, { action: 'endgame', resetScores: true });
  assert.equal(out2.teams[0].score, 0);
});

test('unknown action throws', () => {
  const s = initialState();
  assert.throws(() => applyAction(s, { action: 'nope' }));
});

test('team.add preserves unrelated fields (playedTrackIds, spinSeed)', () => {
  let s = applyAction(initialState(), {
    action: 'spin', selectedGenre: 'rock', trackId: 'abc', spinSeed: 7,
  });
  s = applyAction(s, { action: 'play', now: 100 });
  s = applyAction(s, { action: 'next' });
  s = applyAction(s, { action: 'team.add', id: 't1', name: 'Cats' });
  assert.deepEqual(s.playedTrackIds, ['abc']);
  assert.equal(s.teams.length, 1);
});
