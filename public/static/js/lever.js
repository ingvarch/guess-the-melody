// The jukebox lever: tap it, or drag the knob down past the catch, to spin.
// The lever swings toward the viewer around its hub; CSS draws it from --pull
// (0 up, 1 fully down).

export const LEVER_SWING_DEG = 150; // same angle as .lever in display.html
export const LEVER_CATCH = 0.6;
export const TAP_SLOP_PX = 8;

const SWING_RAD = (LEVER_SWING_DEG * Math.PI) / 180;

// The knob moves down by rod * (1 - cos(angle)), so it stays under the finger.
export function leverPull(dy, rod) {
  const cos = Math.min(1, Math.max(Math.cos(SWING_RAD), 1 - dy / rod));
  return Math.acos(cos) / SWING_RAD;
}

export function leverRelease(dy, rod) {
  if (Math.abs(dy) < TAP_SLOP_PX) return 'tap';
  return leverPull(dy, rod) >= LEVER_CATCH ? 'pull' : 'cancel';
}

// Plays the pull and spring-back once; a pull already under way finishes alone.
// Each pull is announced with a `leverpull` event, for its sound.
export function pullLever(lever, from = 0) {
  if (!lever || lever.classList.contains('lever--pulling')) return;
  lever.style.setProperty('--pull-from', String(from));
  lever.classList.add('lever--pulling');
  lever.dispatchEvent(new lever.ownerDocument.defaultView.CustomEvent('leverpull'));
  const done = () => {
    lever.classList.remove('lever--pulling');
    lever.removeEventListener('animationend', done);
    lever.removeEventListener('animationcancel', done);
  };
  lever.addEventListener('animationend', done);
  lever.addEventListener('animationcancel', done);
}

export function attachLever(lever, { onPull, rodLength = () => lever.querySelector('.lever__rod')?.offsetHeight || 1 }) {
  let drag = null;

  const fire = (from) => {
    pullLever(lever, from);
    onPull();
  };

  const stopDrag = () => {
    drag = null;
    lever.classList.remove('lever--dragging');
    lever.style.removeProperty('--pull');
  };

  lever.addEventListener('pointerdown', (e) => {
    if (lever.disabled) return;
    drag = { startY: e.clientY, rod: rodLength(), pull: 0 };
    lever.setPointerCapture?.(e.pointerId);
  });

  lever.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.pull = leverPull(e.clientY - drag.startY, drag.rod);
    lever.classList.add('lever--dragging');
    lever.style.setProperty('--pull', String(drag.pull));
  });

  lever.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const { startY, rod, pull } = drag;
    stopDrag();
    const release = leverRelease(e.clientY - startY, rod);
    if (release === 'tap') fire(0);
    else if (release === 'pull') fire(pull);
  });

  lever.addEventListener('pointercancel', () => {
    if (drag) stopDrag();
  });

  // Pointer taps are handled on pointerup; a click with detail 0 comes from
  // the keyboard (Enter or Space) or assistive tech.
  lever.addEventListener('click', (e) => {
    if (e.detail === 0 && !lever.disabled) fire(0);
  });
}
