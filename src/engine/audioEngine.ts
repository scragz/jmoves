// AudioEngine — the one shared AudioContext + BufferPool + master chain for the
// whole page (spec §0.1, §2). Many cards, one context. Owns the autoplay unlock
// (spec §5.1), the SaturationSend (spec §4.4), a soft master limiter (spec §8),
// and one analyser (spec §5.9). Default mutual exclusion of players (spec §7).

import { BufferPool } from "./bufferPool";
import { PatternPlayer } from "./patternPlayer";
import { SaturationSend } from "./saturation";
import type { Pattern } from "./types";

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly pool: BufferPool;
  readonly analyser: AnalyserNode;

  private master: GainNode;
  private saturation: SaturationSend;
  private players = new Map<string, PatternPlayer>();
  private current: PatternPlayer | null = null;

  /** when true, starting a player stops the previous one (spec §7). */
  mutualExclusion = true;

  constructor(audioUrls: string[]) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;

    // Soft master limiter — gabber `sat` + voice overlap can clip (spec §8).
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    // master → limiter → analyser → destination
    this.master.connect(limiter);
    limiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Shared saturation bus feeds the limiter alongside the dry master.
    this.saturation = new SaturationSend(this.ctx, limiter);

    this.pool = new BufferPool(this.ctx, audioUrls);
  }

  /** Resume the context inside a user gesture + decode buffers (spec §5.1). */
  async unlock(): Promise<void> {
    if (this.ctx.state !== "running") {
      await this.ctx.resume();
    }
    await this.pool.load();
  }

  private getPlayer(pattern: Pattern): PatternPlayer {
    let player = this.players.get(pattern.id);
    if (!player) {
      player = new PatternPlayer(
        {
          ctx: this.ctx,
          pool: this.pool,
          master: this.master,
          saturation: this.saturation.input,
        },
        pattern,
      );
      this.players.set(pattern.id, player);
    }
    return player;
  }

  async play(pattern: Pattern, onEnded?: () => void): Promise<PatternPlayer> {
    await this.unlock();
    const player = this.getPlayer(pattern);
    if (this.mutualExclusion && this.current && this.current !== player) {
      this.current.stop();
    }
    player.onEnded = onEnded ?? null;
    player.play();
    this.current = player;
    return player;
  }

  stop(pattern: Pattern): void {
    const player = this.players.get(pattern.id);
    player?.stop();
    if (this.current === player) this.current = null;
  }

  stopAll(): void {
    for (const p of this.players.values()) p.stop();
    this.current = null;
  }
}
