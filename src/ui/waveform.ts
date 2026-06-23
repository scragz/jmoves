// One master-analyser visualiser (spec §5.9, §7). A single canvas in the header
// animates the live output while anything is playing.

export function startWaveform(analyser: AnalyserNode, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const data = new Uint8Array(analyser.fftSize);

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const draw = () => {
    requestAnimationFrame(draw);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    analyser.getByteTimeDomainData(data);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = getComputedStyle(canvas).color || "#ff79c6";
    ctx.beginPath();
    const step = data.length / w;
    for (let x = 0; x < w; x++) {
      const v = data[Math.floor(x * step)] / 128 - 1; // -1..1
      const y = h / 2 + v * (h / 2) * 0.95;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  draw();
}
