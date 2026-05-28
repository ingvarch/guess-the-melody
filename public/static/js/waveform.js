// Circular waveform visualiser around the turntable disc.
// Falls back to CSS-only spin when AudioContext is unavailable.

export function attachWaveform({ audioEl, canvas }) {
  if (!canvas || !audioEl) return { stop: () => {} };

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return { stop: () => {} };

  let ctx;
  try {
    ctx = new AudioContext();
  } catch {
    return { stop: () => {} };
  }

  const source = ctx.createMediaElementSource(audioEl);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 128;
  source.connect(analyser);
  analyser.connect(ctx.destination);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  const c2d = canvas.getContext('2d');
  if (!c2d) return { stop: () => {} };

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

      c2d.strokeStyle = `rgba(255, 159, 67, ${0.3 + value / 510})`;
      c2d.lineWidth = 3;
      c2d.beginPath();
      c2d.moveTo(x1, y1);
      c2d.lineTo(x2, y2);
      c2d.stroke();
    }
  }

  draw();

  return {
    stop() {
      running = false;
      if (ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    },
    async resume() {
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { /* user gesture required */ }
      }
    },
  };
}
