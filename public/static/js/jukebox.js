// Jukebox scene builder and spin animation.
// Pure DOM — no framework. Testable with happy-dom.

import { mulberry32 } from './prng.js';

const EASE_STOPS = [
  { t: 0.00, dur: 180 },
  { t: 0.10, dur: 160 },
  { t: 0.20, dur: 140 },
  { t: 0.30, dur: 120 },
  { t: 0.40, dur: 100 },
  { t: 0.50, dur: 90 },
  { t: 0.60, dur: 110 },
  { t: 0.70, dur: 140 },
  { t: 0.80, dur: 200 },
  { t: 0.90, dur: 350 },
  { t: 1.00, dur: 600 },
];

export function buildShelves(doc, genres) {
  const root = doc.getElementById('shelves');
  if (!root) return;
  root.innerHTML = '';
  for (const g of genres) {
    const shelf = doc.createElement('div');
    shelf.className = 'shelf';
    shelf.dataset.genre = g.slug;

    const label = doc.createElement('span');
    label.className = 'shelf__label';
    label.textContent = g.name;

    const records = doc.createElement('div');
    records.className = 'shelf__records';

    // 3-6 records per shelf for visual density.
    const count = 3 + (g.slug.length % 4);
    for (let i = 0; i < count; i++) {
      const rec = doc.createElement('div');
      rec.className = 'record';
      records.append(rec);
    }

    shelf.append(label, records);
    root.append(shelf);
  }
}

export async function runSpinAnimation({ doc, genres, selectedGenre, spinSeed, durationMs = 3500 }) {
  const root = doc.getElementById('shelves');
  if (!root || genres.length === 0) return;

  const prng = mulberry32(spinSeed || 1);
  const shelves = Array.from(root.querySelectorAll('.shelf'));
  const targetIndex = shelves.findIndex((s) => s.dataset.genre === selectedGenre);
  const endIndex = targetIndex >= 0 ? targetIndex : Math.floor(prng() * shelves.length);

  // Reset highlights.
  for (const s of shelves) s.classList.remove('highlighted');

  let elapsed = 0;
  let prevIndex = -1;

  for (const stop of EASE_STOPS) {
    const delay = Math.round(stop.dur * (durationMs / 3500));
    await wait(delay);
    elapsed += delay;

    if (prevIndex >= 0) shelves[prevIndex].classList.remove('highlighted');

    let idx;
    if (stop.t >= 1.0) {
      idx = endIndex;
    } else {
      // Pick a random shelf different from the previous one.
      do { idx = Math.floor(prng() * shelves.length); }
      while (idx === prevIndex && shelves.length > 1);
    }

    shelves[idx].classList.add('highlighted');
    prevIndex = idx;
  }

  // Leave the target highlighted; the caller will clear it later.
}

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
