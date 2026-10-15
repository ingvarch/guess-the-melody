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

export function pickSpinTarget(genreIndex, genreCount, rowCount, prng) {
  const copies = rowCount / genreCount;
  const row = genreIndex + genreCount * Math.floor(prng() * copies);
  const turns = MIN_SPIN_TURNS + Math.floor(prng() * 2);
  return { row, angle: turns * 360 + rowAngle(row, rowCount) };
}
