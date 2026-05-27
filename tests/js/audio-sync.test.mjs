import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioCurrentTime } from '../../public/static/js/audio-sync.js';

test('returns 0 when now equals start', () => {
  assert.equal(audioCurrentTime(1000, 1000, 30), 0);
});

test('returns elapsed seconds', () => {
  assert.equal(audioCurrentTime(15000, 10000, 30), 5);
});

test('clamps at duration', () => {
  assert.equal(audioCurrentTime(100000, 10000, 30), 30);
});

test('returns 0 when start is null', () => {
  assert.equal(audioCurrentTime(15000, null, 30), 0);
});

test('returns 0 when now is before start (clock skew)', () => {
  assert.equal(audioCurrentTime(5000, 10000, 30), 0);
});

test('returns 0 when start is undefined', () => {
  assert.equal(audioCurrentTime(15000, undefined, 30), 0);
});

test('returns exactly duration at the boundary', () => {
  assert.equal(audioCurrentTime(40000, 10000, 30), 30);
});
