// Circular waveform visualiser around the turntable disc.
// Falls back to CSS-only spin when AudioContext is unavailable.

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
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(cx, cy) - 16;
  const barCount = 64;
  const barWidth = (Math.PI * 2) / barCount;

  function draw() {
    if (!running) return;
    requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);
    c2d.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i % bufferLength];
      const barHeight = (value / 255) * radius * 0.6;
      const angle = i * barWidth - Math.PI / 2;

      const x1 = cx + Math.cos(angle) * (radius - barHeight);
      const y1 = cy + Math.sin(angle) * (radius - barHeight);
      const x2 = cx + Math.cos(angle) * radius;
      const y2 = cy + Math.sin(angle) * radius;

      // Sonic Pulse palette: cyan secondary on the beats, violet primary between.
      const alpha = 0.35 + value / 400;
      c2d.strokeStyle = i % 4 === 0
        ? `rgba(76, 215, 246, ${alpha})`
        : `rgba(208, 188, 255, ${alpha})`;
      c2d.lineWidth = 3;
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

  return { stop, start, resume, suspended };
}
