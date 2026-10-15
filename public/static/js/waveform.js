// Circular waveform visualiser around the turntable record.
// Without an AudioContext the record still spins; only the ring is missing.

// One bar of the ring: starts at the record edge (`inner`) and grows outward
// by up to `reach`. Bar 0 points straight up; bars go clockwise.
export function ringBar(i, value, { cx, cy, inner, reach, count }) {
  const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
  const outer = inner + (value / 255) * reach;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x1: cx + cos * inner, y1: cy + sin * inner, x2: cx + cos * outer, y2: cy + sin * outer };
}

// The top analyser bins are near silent, so the right half of the ring reads
// the low and mid bins and the left half mirrors them.
export function ringBin(i, count) {
  return i <= count / 2 ? i : count - i;
}

export function attachWaveform({ audioEl, canvas }) {
  if (!canvas || !audioEl) return { stop: () => {}, suspended: () => false };

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return { stop: () => {}, suspended: () => false };

  let ctx;
  let analyser;
  try {
    ctx = new AudioContext();
    // createMediaElementSource throws if this element already has a source
    // (it may be created only once per element). Fall back to a no-op rather
    // than letting it break the render path; the clip still plays via the
    // element's own output.
    const source = ctx.createMediaElementSource(audioEl);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    analyser.connect(ctx.destination);
  } catch {
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    return { stop: () => {}, suspended: () => false };
  }

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  const c2d = canvas.getContext('2d');
  if (!c2d) return { stop: () => {}, suspended: () => false };

  let running = true;
  // The canvas is 1.5x the record (CSS inset: -25%), so the record edge is at width / 3.
  const ring = {
    cx: canvas.width / 2,
    cy: canvas.height / 2,
    inner: canvas.width / 3 + canvas.width / 60,
    reach: canvas.width / 6 - canvas.width / 30,
    count: 64,
  };

  function draw() {
    if (!running) return;
    requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);
    c2d.clearRect(0, 0, canvas.width, canvas.height);

    c2d.lineWidth = canvas.width / 180;
    c2d.lineCap = 'round';
    c2d.shadowBlur = canvas.width / 60;
    for (let i = 0; i < ring.count; i++) {
      const value = dataArray[ringBin(i, ring.count) % bufferLength];
      const { x1, y1, x2, y2 } = ringBar(i, value, ring);

      // Sonic Pulse palette: cyan secondary on the beats, violet primary between.
      const alpha = 0.35 + value / 400;
      const color = i % 4 === 0
        ? `rgba(76, 215, 246, ${alpha})`
        : `rgba(208, 188, 255, ${alpha})`;
      c2d.strokeStyle = color;
      c2d.shadowColor = color;
      c2d.beginPath();
      c2d.moveTo(x1, y1);
      c2d.lineTo(x2, y2);
      c2d.stroke();
    }
  }

  draw();

  // A MediaElementSourceNode can be created only ONCE per <audio> element, and
  // once created the element's output is routed through this AudioContext for
  // good. So we must NEVER close the context between rounds — doing so leaves
  // the element wired to a dead context and it plays silently. stop() only
  // pauses the render loop; the context + source live for the page lifetime.
  function start() {
    if (!running) {
      running = true;
      draw();
    }
  }
  function stop() {
    running = false;
    c2d.clearRect(0, 0, canvas.width, canvas.height);
  }
  async function resume() {
    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch { /* user gesture required */ }
    start();
  }

  // Suspended = the element's output is routed through a context the browser
  // has not unlocked yet, so playback is silent even when play() resolves.
  function suspended() {
    return ctx.state === 'suspended';
  }

  // Other sounds (the jukebox cue) play into the analyser, so the ring shows them too.
  return { stop, start, resume, suspended, context: ctx, input: analyser };
}
