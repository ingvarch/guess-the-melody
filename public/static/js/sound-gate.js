// Autoplay gate for the display page. Browsers refuse audible playback until
// the page sees a user gesture: audio.play() rejects with NotAllowedError,
// and a MediaElementSource routed through a suspended AudioContext plays
// silence even when play() succeeds. The gate owns starting playback: it is
// re-synced on every state frame and clock tick, shows the "tap for sound"
// overlay while blocked, and unlocks from the tap handler (a real gesture).

export function createSoundGate({ doc, audio, getWaveform = () => null }) {
  const overlay = doc.getElementById('sound-gate');
  const msgEl = doc.getElementById('sound-gate-message');
  const defaultMsg = msgEl?.textContent ?? '';

  function show() { overlay?.removeAttribute('hidden'); }
  function hide() {
    overlay?.setAttribute('hidden', '');
    // A load-failure message must not outlive the failure: the next time the
    // overlay surfaces it is about autoplay again.
    if (msgEl) msgEl.textContent = defaultMsg;
  }

  function waveformSuspended() {
    return getWaveform()?.suspended?.() ?? false;
  }

  function ensurePlaying() {
    if (!audio) return;
    if (audio.paused) {
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(
          () => { if (waveformSuspended()) show(); else hide(); },
          () => show(),
        );
      }
      return;
    }
    if (waveformSuspended()) show();
    else hide();
  }

  // shouldPlay: the shared state says the clip must be audible right now.
  function sync(shouldPlay) {
    if (shouldPlay) ensurePlaying();
    else hide();
  }

  function unlock() {
    // Runs inside a real user gesture: resume the context first, then play.
    const resumed = getWaveform()?.resume?.();
    const kick = () => ensurePlaying();
    if (resumed && typeof resumed.then === 'function') resumed.then(kick, kick);
    else kick();
  }

  overlay?.addEventListener('click', unlock);

  audio?.addEventListener('error', () => {
    if (msgEl) msgEl.textContent = 'Audio failed to load';
    show();
  });

  return { sync };
}
