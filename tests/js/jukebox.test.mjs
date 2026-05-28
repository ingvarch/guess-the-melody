// Unit tests for jukebox scene builder and spin animation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

function makeDoc() {
  const win = new Window();
  win.SyntaxError = SyntaxError;
  win.Error = Error;
  const doc = win.document;
  doc.body.innerHTML = '<div id="shelves"></div>';
  return doc;
}

const mod = await import('../../public/static/js/jukebox.js');
const { buildShelves, runSpinAnimation } = mod;

test('buildShelves creates one shelf per genre with records', () => {
  const doc = makeDoc();
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
  ];
  buildShelves(doc, genres);
  const shelves = doc.querySelectorAll('.shelf');
  assert.equal(shelves.length, 2);
  assert.equal(shelves[0].dataset.genre, 'rock');
  assert.equal(shelves[1].dataset.genre, 'pop');
  assert.ok(shelves[0].querySelector('.shelf__label').textContent.includes('Rock'));
  const records = shelves[0].querySelectorAll('.record');
  assert.ok(records.length >= 3);
});

test('runSpinAnimation resolves and highlights the selectedGenre shelf', async () => {
  const doc = makeDoc();
  const genres = [
    { slug: 'rock', name: 'Rock' },
    { slug: 'pop', name: 'Pop' },
    { slug: 'jazz', name: 'Jazz' },
  ];
  buildShelves(doc, genres);
  await runSpinAnimation({
    doc,
    genres,
    selectedGenre: 'pop',
    spinSeed: 42,
    durationMs: 200,
  });
  const shelves = doc.querySelectorAll('.shelf');
  const highlighted = Array.from(shelves).filter((s) => s.classList.contains('highlighted'));
  assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0].dataset.genre, 'pop');
});

test('runSpinAnimation falls back to random shelf when selectedGenre not found', async () => {
  const doc = makeDoc();
  const genres = [{ slug: 'rock', name: 'Rock' }];
  buildShelves(doc, genres);
  await runSpinAnimation({
    doc,
    genres,
    selectedGenre: 'unknown',
    spinSeed: 1,
    durationMs: 200,
  });
  const shelves = doc.querySelectorAll('.shelf');
  assert.ok(shelves[0].classList.contains('highlighted'));
});
