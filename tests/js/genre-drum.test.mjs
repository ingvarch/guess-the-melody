import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../public/static/js/prng.js';
import {
  MIN_DRUM_ROWS,
  MIN_SPIN_TURNS,
  drumRows,
  rowAngle,
  drumRadiusEm,
  pickSpinTarget,
} from '../../public/static/js/genre-drum.js';

test('drumRows: repeats the genres whole so the cylinder closes without a seam', () => {
  const six = ['A', 'B', 'C', 'D', 'E', 'F'];
  const rows = drumRows(six);
  assert.ok(rows.length >= MIN_DRUM_ROWS);
  assert.equal(rows.length % six.length, 0);
  rows.forEach((name, i) => assert.equal(name, six[i % six.length]));
});

test('drumRows: a long genre list is used once as is', () => {
  const many = Array.from({ length: MIN_DRUM_ROWS + 5 }, (_, i) => `G${i}`);
  assert.deepEqual(drumRows(many), many);
});

test('drumRows: no genres, no rows', () => {
  assert.deepEqual(drumRows([]), []);
});

test('rowAngle: rows share the full turn evenly', () => {
  assert.equal(rowAngle(0, 24), 0);
  assert.equal(rowAngle(6, 24), 90);
  assert.equal(rowAngle(12, 24), 180);
});

test('drumRadiusEm: neighbouring rows sit one line apart at the front', () => {
  for (const rows of [20, 24, 30]) {
    const r = drumRadiusEm(rows, 1.2);
    const gap = 2 * r * Math.sin(Math.PI / rows);
    assert.ok(Math.abs(gap - 1.2) < 1e-9, `rows=${rows} gap=${gap}`);
  }
});

test('pickSpinTarget: lands on a row that holds the chosen genre after several turns', () => {
  const names = ['Rock', 'Pop', 'Jazz', 'Soundtrack', 'Hip-Hop'];
  const rows = drumRows(names);
  for (let seed = 1; seed <= 50; seed++) {
    const { row, angle } = pickSpinTarget(2, names.length, rows.length, mulberry32(seed));
    assert.equal(rows[row], 'Jazz', `seed ${seed}`);
    assert.ok(angle >= MIN_SPIN_TURNS * 360, `seed ${seed}: only ${angle}deg`);
    const rest = ((angle % 360) + 360) % 360;
    assert.ok(Math.abs(rest - rowAngle(row, rows.length)) < 1e-9, `seed ${seed}: rests at ${rest}deg`);
  }
});

test('pickSpinTarget: the same seed gives every viewer the same spin', () => {
  const a = pickSpinTarget(1, 6, 24, mulberry32(99));
  const b = pickSpinTarget(1, 6, 24, mulberry32(99));
  assert.deepEqual(a, b);
});
