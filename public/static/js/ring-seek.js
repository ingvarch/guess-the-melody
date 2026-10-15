// Seeking by dragging around the progress ring that circles the record.

// Share of the clip at a point (dx, dy) from the record center: the clip runs
// clockwise from 12 o'clock.
export function ringPosition(dx, dy) {
  const turn = Math.atan2(dx, -dy) / (2 * Math.PI);
  return turn < 0 ? turn + 1 : turn;
}

export function attachRingSeek(ring, { enabled, onScrub, onSeek, onCancel }) {
  let dragging = false;

  const positionOf = (e) => {
    const box = ring.getBoundingClientRect();
    return ringPosition(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2));
  };

  ring.addEventListener('pointerdown', (e) => {
    if (!enabled()) return;
    dragging = true;
    ring.setPointerCapture?.(e.pointerId);
    onScrub(positionOf(e));
  });

  ring.addEventListener('pointermove', (e) => {
    if (dragging) onScrub(positionOf(e));
  });

  ring.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    onSeek(positionOf(e));
  });

  ring.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging = false;
    onCancel();
  });
}
