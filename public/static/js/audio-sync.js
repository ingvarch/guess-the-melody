// Clip position as m:ss. Shared by the display and the host console so both
// readouts render identically.
export function formatClock(sec) {
  const safe = Math.max(0, Math.floor(sec));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

// When pausedAt is a timestamp the clock is frozen there, so a paused clip
// holds its position regardless of the wall clock.
export function audioCurrentTime(now, start, durationSec, pausedAt = null) {
  if (start === null || start === undefined) return 0;
  const effectiveNow = pausedAt === null || pausedAt === undefined ? now : pausedAt;
  const elapsedSec = (effectiveNow - start) / 1000;
  if (elapsedSec < 0) return 0;
  if (elapsedSec > durationSec) return durationSec;
  return elapsedSec;
}
