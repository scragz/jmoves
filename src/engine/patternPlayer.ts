// PatternPlayer — one per playing card. Owns a lookahead scheduler driven by the
// Web Audio clock (spec §4.1), a transport position, and an output bus. Turns
// each step's cells into disposable Voices (spec §4.2) / SubVoices (spec §4.3).

import type { BufferPool } from "./bufferPool";
import type {
  Lane,
  Pattern,
  SliceCellObject,
  SubCellObject,
} from "./types";

const LOOKAHEAD_MS = 25; // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.1; // seconds scheduled into the future
const ATTACK = 0.002; // 2 ms — kills the start click (spec §4.2)
const RELEASE = 0.004; // ~4 ms — kills the truncation click (spec §4.2)
const VOICE_CAP = 16; // per-lane polyphony cap; steal oldest beyond this

interface ActiveVoice {
  gain: GainNode;
  source: AudioScheduledSourceNode;
  end: number;
}

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function noteToHz(note: number | string): number {
  if (typeof note === "number") return midiToHz(note);
  const hz = parseFloat(note);
  return Number.isFinite(hz) ? hz : 55;
}

export interface PatternPlayerDeps {
  ctx: AudioContext;
  pool: BufferPool;
  /** the engine master input the player's bus connects to. */
  master: AudioNode;
  /** the shared SaturationSend input (per-cell `sat` routes here). */
  saturation: AudioNode;
}

export class PatternPlayer {
  readonly pattern: Pattern;
  /** invoked when a non-looping pattern reaches its end. */
  onEnded: (() => void) | null = null;

  private ctx: AudioContext;
  private pool: BufferPool;
  private saturation: AudioNode;
  private bus: GainNode;

  private stepDur: number;
  private totalSteps: number;
  private swing: number;
  private loop: boolean;

  private playing = false;
  private currentStep = 0;
  private nextStepTime = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finishing = false;
  private endTime = 0;

  // per-lane voice tracking for stealing, and per-sub-lane last frequency for glide.
  private active: ActiveVoice[][] = [];
  private lastSubFreq: number[] = [];

  constructor(deps: PatternPlayerDeps, pattern: Pattern) {
    this.ctx = deps.ctx;
    this.pool = deps.pool;
    this.saturation = deps.saturation;
    this.pattern = pattern;

    this.bus = this.ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(deps.master);

    // stepDur = 60 / bpm / (stepsPerBar / 4) seconds (spec §3.1).
    this.stepDur = 60 / pattern.bpm / (pattern.stepsPerBar / 4);
    this.totalSteps = pattern.bars * pattern.stepsPerBar;
    this.swing = pattern.swing ?? 0;
    this.loop = pattern.loop ?? true;

    this.active = pattern.lanes.map(() => []);
    this.lastSubFreq = pattern.lanes.map(() => 0);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.finishing = false;
    this.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    this.scheduler();
  }

  stop(): void {
    if (!this.playing && !this.timer) return;
    this.playing = false;
    this.finishing = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Fade out any ringing voices to avoid a stop click.
    const now = this.ctx.currentTime;
    for (const lane of this.active) {
      for (const v of lane) {
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), now);
          v.gain.gain.linearRampToValueAtTime(0, now + 0.02);
          v.source.stop(now + 0.03);
        } catch {
          /* already stopped */
        }
      }
    }
    this.active = this.pattern.lanes.map(() => []);
  }

  dispose(): void {
    this.stop();
    this.bus.disconnect();
  }

  // ---- scheduler (spec §4.1) -------------------------------------------------

  private scheduler = (): void => {
    while (
      !this.finishing &&
      this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD
    ) {
      this.scheduleStep(this.currentStep, this.nextStepTime);
      this.advance();
    }

    if (this.finishing) {
      if (this.ctx.currentTime >= this.endTime) {
        const cb = this.onEnded;
        this.stop();
        cb?.();
        return;
      }
    }

    if (this.playing) {
      this.timer = setTimeout(this.scheduler, LOOKAHEAD_MS);
    }
  };

  private advance(): void {
    this.nextStepTime += this.stepDur;
    this.currentStep++;
    if (this.currentStep >= this.totalSteps) {
      if (this.loop) {
        this.currentStep = 0;
      } else {
        this.finishing = true;
        this.endTime = this.nextStepTime + 0.5; // tail for ringing voices
      }
    }
  }

  private swingDelay(step: number): number {
    if (this.swing <= 0) return 0;
    // Push every other (off-grid) 16th late, up to ~half a step at swing = 1.
    const inBar = step % this.pattern.stepsPerBar;
    return inBar % 2 === 1 ? this.swing * this.stepDur * 0.5 : 0;
  }

  private scheduleStep(step: number, gridTime: number): void {
    const time = gridTime + this.swingDelay(step);
    const lanes = this.pattern.lanes;
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li];
      const raw = lane.steps[step];
      if (raw === null || raw === undefined || raw === 0) continue;
      if (lane.type === "slice") {
        this.scheduleSlice(this.normalizeSlice(raw), time, li);
      } else {
        if (typeof raw === "number") continue; // sub lanes need objects
        this.scheduleSub(raw as SubCellObject, time, li, lane);
      }
    }
  }

  private normalizeSlice(raw: unknown): SliceCellObject {
    if (typeof raw === "number") return { slice: raw };
    return raw as SliceCellObject;
  }

  // ---- slice voices (spec §4.2) ---------------------------------------------

  private scheduleSlice(cell: SliceCellObject, time: number, laneIdx: number): void {
    if ((cell.prob ?? 1) < 1 && Math.random() >= (cell.prob ?? 1)) return;

    const ratchet = Math.max(1, Math.round(cell.ratchet ?? 1));
    const sub = this.stepDur / ratchet;
    for (let r = 0; r < ratchet; r++) {
      this.triggerSlice(cell, time + r * sub, laneIdx);
    }
  }

  private triggerSlice(cell: SliceCellObject, when: number, laneIdx: number): void {
    const buffer = this.pool.get(cell.slice, cell.reverse ?? false);
    const rate = cell.rate ?? 1;
    const offset = cell.offset ?? 0;
    const gain = cell.gain ?? 1;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    const env = this.ctx.createGain();
    source.connect(env);

    let tail: AudioNode = env;
    if (cell.pan && cell.pan !== 0) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, cell.pan));
      env.connect(panner);
      tail = panner;
    }
    tail.connect(this.bus);

    // per-cell saturation send
    if (cell.sat && cell.sat > 0) {
      const send = this.ctx.createGain();
      send.gain.value = Math.min(1, cell.sat);
      tail.connect(send);
      send.connect(this.saturation);
    }

    // Output-time duration: rate couples pitch + time (spec §5.5). The remaining
    // buffer past `offset` plays back faster/slower by `rate`.
    const remaining = (buffer.duration - offset) / rate;
    const playDur = Math.max(0.005, remaining);
    const hold = cell.gate == null ? playDur : Math.min(cell.gate, playDur);

    // Envelope: 2 ms attack, hold, ~4 ms release at gate/slice end (spec §4.2).
    const relStart = when + Math.max(ATTACK, hold - RELEASE);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + ATTACK);
    env.gain.setValueAtTime(gain, relStart);
    env.gain.linearRampToValueAtTime(0, relStart + RELEASE);

    const stopAt = relStart + RELEASE + 0.005;
    source.start(when, offset);
    source.stop(stopAt);

    this.track(laneIdx, { gain: env, source, end: stopAt });
  }

  // ---- sub voices (spec §4.3) -----------------------------------------------

  private scheduleSub(
    cell: SubCellObject,
    when: number,
    laneIdx: number,
    _lane: Lane,
  ): void {
    if ((cell.prob ?? 1) < 1 && Math.random() >= (cell.prob ?? 1)) return;

    const freq = noteToHz(cell.note);
    const gain = cell.gain ?? 0.9;
    const hold = cell.gate ?? this.stepDur * 0.9;
    const glide = cell.glide ?? 0;

    const osc = this.ctx.createOscillator();
    osc.type = "sine";

    const prev = this.lastSubFreq[laneIdx];
    if (glide > 0 && prev > 0) {
      osc.frequency.setValueAtTime(prev, when);
      osc.frequency.exponentialRampToValueAtTime(freq, when + glide);
    } else {
      osc.frequency.setValueAtTime(freq, when);
    }
    this.lastSubFreq[laneIdx] = freq;

    const env = this.ctx.createGain();
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = 120;

    osc.connect(env);
    env.connect(lpf);
    lpf.connect(this.bus);

    const relStart = when + Math.max(ATTACK, hold - RELEASE * 4);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.006);
    env.gain.setValueAtTime(gain, relStart);
    env.gain.linearRampToValueAtTime(0, relStart + RELEASE * 4);

    const stopAt = relStart + RELEASE * 4 + 0.01;
    osc.start(when);
    osc.stop(stopAt);

    this.track(laneIdx, { gain: env, source: osc, end: stopAt });
  }

  // ---- polyphony / voice stealing (spec §4.2) -------------------------------

  private track(laneIdx: number, voice: ActiveVoice): void {
    const list = this.active[laneIdx];
    const now = this.ctx.currentTime;
    // prune voices that have already finished
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].end <= now) list.splice(i, 1);
    }
    if (list.length >= VOICE_CAP) {
      const oldest = list.shift();
      if (oldest) {
        try {
          oldest.gain.gain.cancelScheduledValues(now);
          oldest.gain.gain.setValueAtTime(
            Math.max(oldest.gain.gain.value, 0.0001),
            now,
          );
          oldest.gain.gain.linearRampToValueAtTime(0, now + 0.01);
          oldest.source.stop(now + 0.02);
        } catch {
          /* already stopped */
        }
      }
    }
    list.push(voice);
  }
}
