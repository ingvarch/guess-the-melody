// Geometry of the genre drum: a CSS 3D cylinder of genre names that spins
// and stops on the picked genre. Angles are in degrees.

export const MIN_DRUM_ROWS = 20;
export const MIN_SPIN_TURNS = 4;

// Whole copies of the list, so the sequence never breaks where the cylinder closes.
export function drumRows(names) {
  if (names.length === 0) return [];
  const copies = Math.ceil(MIN_DRUM_ROWS / names.length);
  return Array.from({ length: names.length * copies }, (_, i) => names[i % names.length]);
}

export function rowAngle(row, rowCount) {
  return (row * 360) / rowCount;
}

export function drumRadiusEm(rowCount, lineEm) {
  return lineEm / (2 * Math.sin(Math.PI / rowCount));
}

// `from` is where the drum stands now; the spin starts from the next full turn.
export function pickSpinTarget(genreIndex, genreCount, rowCount, prng, from = 0) {
  const copies = rowCount / genreCount;
  const row = genreIndex + genreCount * Math.floor(prng() * copies);
  const turns = MIN_SPIN_TURNS + Math.floor(prng() * 2);
  return { row, angle: Math.ceil(from / 360) * 360 + turns * 360 + rowAngle(row, rowCount) };
}

// The copy of the genre closest to `from`, so the drum turns the short way.
export function nearestRowAngle(genreIndex, genreCount, rowCount, from) {
  const period = (360 * genreCount) / rowCount;
  const base = rowAngle(genreIndex, rowCount);
  return base + Math.round((from - base) / period) * period;
}

// The drum's easing (a CSS cubic-bezier): fast at first, a long slow stop.
export const SPIN_EASE = Object.freeze([0.25, 0.6, 0.3, 1]);

function bezier(p1, p2, s) {
  return 3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;
}

// Share of the turn's time at which the drum has covered `share` of its turn.
function timeAtShare(share) {
  const [x1, y1, x2, y2] = SPIN_EASE;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(y1, y2, mid) < share) lo = mid;
    else hi = mid;
  }
  return bezier(x1, x2, (lo + hi) / 2);
}

// When, in ms into a turn from `from` to `to`, each row reaches the center:
// one click per row, either way round.
export function spinTicks(from, to, step, durationMs) {
  const dir = Math.sign(to - from);
  if (dir === 0) return [];
  const ticks = [];
  const eps = 1e-9;
  let k = dir > 0 ? Math.floor(from / step + eps) + 1 : Math.ceil(from / step - eps) - 1;
  for (; dir > 0 ? k * step <= to + eps : k * step >= to - eps; k += dir) {
    ticks.push(timeAtShare((k * step - from) / (to - from)) * durationMs);
  }
  return ticks;
}
