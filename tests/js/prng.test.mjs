import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../public/static/js/prng.js';

test('mulberry32: same seed produces same sequence', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 10; i++) {
    assert.equal(a(), b());
  }
});

test('mulberry32: different seeds produce different sequences', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  assert.notEqual(a(), b());
});

test('mulberry32: outputs are in [0, 1)', () => {
  const r = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});
