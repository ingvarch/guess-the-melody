export function audioCurrentTime(now, start, durationSec) {
  if (start === null || start === undefined) return 0;
  const elapsedSec = (now - start) / 1000;
  if (elapsedSec < 0) return 0;
  if (elapsedSec > durationSec) return durationSec;
  return elapsedSec;
}
