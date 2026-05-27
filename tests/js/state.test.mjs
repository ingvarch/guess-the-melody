import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  addTeam,
  renameTeam,
  removeTeam,
  awardPoints,
} from '../../public/static/js/state.js';

test('initialState: idle phase, empty teams, empty playedTrackIds', () => {
  const s = initialState();
  assert.equal(s.phase, 'idle');
  assert.deepEqual(s.teams, []);
  assert.deepEqual(s.playedTrackIds, []);
  assert.equal(s.currentTrack, null);
  assert.equal(s.revealedTrack, null);
  assert.equal(s.selectedGenre, null);
  assert.equal(s.spinSeed, 0);
  assert.equal(s.audioStartTimestamp, null);
});

test('addTeam: appends with zero score', () => {
  const s = initialState();
  const out = addTeam(s, { id: 't1', name: 'Cats' });
  assert.equal(out.teams.length, 1);
  assert.deepEqual(out.teams[0], { id: 't1', name: 'Cats', score: 0 });
});

test('renameTeam: updates name by id', () => {
  let s = addTeam(initialState(), { id: 't1', name: 'Cats' });
  s = renameTeam(s, { id: 't1', name: 'Dogs' });
  assert.equal(s.teams[0].name, 'Dogs');
});

test('removeTeam: drops by id', () => {
  let s = addTeam(initialState(), { id: 't1', name: 'Cats' });
  s = addTeam(s, { id: 't2', name: 'Dogs' });
  s = removeTeam(s, { id: 't1' });
  assert.equal(s.teams.length, 1);
  assert.equal(s.teams[0].id, 't2');
});

test('awardPoints: +1 increments score', () => {
  let s = addTeam(initialState(), { id: 't1', name: 'Cats' });
  s = awardPoints(s, { teamId: 't1', points: 1 });
  assert.equal(s.teams[0].score, 1);
});

test('awardPoints: +2 increments score by 2', () => {
  let s = addTeam(initialState(), { id: 't1', name: 'Cats' });
  s = awardPoints(s, { teamId: 't1', points: 2 });
  assert.equal(s.teams[0].score, 2);
});

test('awardPoints: rejects non-1-or-2 values', () => {
  const s = addTeam(initialState(), { id: 't1', name: 'Cats' });
  assert.throws(() => awardPoints(s, { teamId: 't1', points: 3 }));
  assert.throws(() => awardPoints(s, { teamId: 't1', points: 0 }));
  assert.throws(() => awardPoints(s, { teamId: 't1', points: -1 }));
});

test('awardPoints: unknown teamId throws', () => {
  const s = initialState();
  assert.throws(() => awardPoints(s, { teamId: 'nope', points: 1 }));
});

test('mutators are pure (do not mutate input)', () => {
  const s = initialState();
  addTeam(s, { id: 't1', name: 'X' });
  assert.equal(s.teams.length, 0);
});

test('awardPoints: returns a new teams array and new team object', () => {
  const s = addTeam(initialState(), { id: 't1', name: 'X' });
  const out = awardPoints(s, { teamId: 't1', points: 1 });
  assert.notStrictEqual(out.teams, s.teams);
  assert.notStrictEqual(out.teams[0], s.teams[0]);
});
