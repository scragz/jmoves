// BufferPool — fetch + decode the 16 Amen WAVs once and share them across every
// player. Also precomputes a reversed copy of each buffer (spec §5.6: negative
// playbackRate is unreliable, so reverse reads from a parallel pool).

function reverseBuffer(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const from = src.getChannelData(ch);
    const to = out.getChannelData(ch);
    const n = from.length;
    for (let i = 0; i < n; i++) to[i] = from[n - 1 - i];
  }
  return out;
}

export class BufferPool {
  private forward: AudioBuffer[] = [];
  private reversed: AudioBuffer[] = [];
  private loading: Promise<void> | null = null;
  loaded = false;

  constructor(
    private ctx: BaseAudioContext,
    private urls: string[],
  ) {}

  /** Fetch + decode all slices once. Safe to call repeatedly. */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const decoded = await Promise.all(
        this.urls.map(async (url) => {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`failed to fetch ${url}: ${resp.status}`);
          const data = await resp.arrayBuffer();
          return this.ctx.decodeAudioData(data);
        }),
      );
      this.forward = decoded;
      this.reversed = decoded.map((b) => reverseBuffer(this.ctx, b));
      this.loaded = true;
    })();
    return this.loading;
  }

  /** Get slice 1–16 (1-indexed), forward or reversed. */
  get(slice: number, reverse = false): AudioBuffer {
    const idx = Math.max(1, Math.min(this.forward.length, Math.round(slice))) - 1;
    const buf = (reverse ? this.reversed : this.forward)[idx];
    if (!buf) throw new Error(`buffer ${slice} not loaded`);
    return buf;
  }
}
