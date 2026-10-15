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
  nearestRowAngle,
  spinTicks,
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

test('pickSpinTarget: a drum already turned elsewhere still spins several turns and lands on the genre', () => {
  const names = ['Rock', 'Pop', 'Jazz'];
  const rows = drumRows(names);
  for (const from of [37, 359, 1234.5, 7200]) {
    const { row, angle } = pickSpinTarget(1, names.length, rows.length, mulberry32(4), from);
    assert.equal(rows[row], 'Pop');
    assert.ok(angle - from >= MIN_SPIN_TURNS * 360, `from ${from}: only ${angle - from}deg`);
    const rest = ((angle % 360) + 360) % 360;
    assert.ok(Math.abs(rest - rowAngle(row, rows.length)) < 1e-9, `from ${from}: rests at ${rest}deg`);
  }
});

test('nearestRowAngle: turns to the closest copy of the genre, forward or back', () => {
  // 3 genres on 21 rows: each genre repeats every 7 copies, 51.43deg apart.
  const rows = drumRows(['Rock', 'Pop', 'Jazz']);
  const period = (360 * 3) / rows.length;
  const front = (angle) => rows[Math.round((((angle % 360) + 360) % 360) / (360 / rows.length)) % rows.length];
  for (const from of [0, 10, 200, -30, 1000]) {
    const angle = nearestRowAngle(2, 3, rows.length, from);
    assert.equal(front(angle), 'Jazz', `from ${from}`);
    assert.ok(Math.abs(angle - from) <= period / 2 + 1e-9, `from ${from}: turned ${angle - from}deg`);
  }
});

test('spinTicks: one click per row reaching the center, the last as the drum stops', () => {
  const step = 18;
  const ticks = spinTicks(0, 4 * 360 + 5 * step, step, 8000);
  assert.equal(ticks.length, 4 * 20 + 5);
  ticks.slice(1).forEach((t, i) => assert.ok(t > ticks[i], 'in order'));
  assert.ok(ticks[0] > 0);
  assert.ok(Math.abs(ticks.at(-1) - 8000) < 1, `last click at ${ticks.at(-1)}ms`);
});

test('spinTicks: the clicks slow down with the drum', () => {
  const ticks = spinTicks(0, 4 * 360, 18, 8000);
  const firstGap = ticks[1] - ticks[0];
  const lastGap = ticks.at(-1) - ticks.at(-2);
  assert.ok(lastGap > firstGap * 5, `first gap ${firstGap}ms, last ${lastGap}ms`);
});

test('spinTicks: turning back the short way clicks too', () => {
  const ticks = spinTicks(100, 54, 18, 600);
  assert.equal(ticks.length, 3, 'rows at 90, 72 and 54');
  assert.ok(Math.abs(ticks.at(-1) - 600) < 1);
});

test('spinTicks: no turn, no clicks', () => {
  assert.deepEqual(spinTicks(54, 54, 18, 600), []);
});
