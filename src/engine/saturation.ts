// SaturationSend — a shared WaveShaper distortion bus for the gabber constructs
// (spec §4.4). One shaper for the whole engine: cheaper, and a shared distortion
// bus is sonically correct for the genre. Per-cell `sat` sets the send amount,
// which drives the signal harder into the fixed tanh curve.

const CURVE_SAMPLES = 2048;
const DRIVE = 4;

function makeTanhCurve(): Float32Array<ArrayBuffer> {
  // Build the curve once (spec §4.4 curve note: rebuilding per trigger is a GC
  // hazard). Plain tanh wave-shaping; the per-cell send gain controls how hard
  // the signal is pushed in, so low `sat` stays in the near-linear region and
  // high `sat` clips.
  const curve = new Float32Array(new ArrayBuffer(CURVE_SAMPLES * 4));
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const x = (i / (CURVE_SAMPLES - 1)) * 2 - 1;
    curve[i] = Math.tanh(DRIVE * x);
  }
  return curve;
}

export class SaturationSend {
  /** Voices connect their per-cell send gain here. */
  readonly input: GainNode;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.input = ctx.createGain();
    this.input.gain.value = 1;

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeTanhCurve();
    // Without oversampling, hard-clipping aliases and sounds digital-harsh
    // rather than analog-brutal (spec §4.4).
    shaper.oversample = "4x";

    const makeup = ctx.createGain();
    makeup.gain.value = 0.7;

    this.input.connect(shaper);
    shaper.connect(makeup);
    makeup.connect(destination);
  }
}
