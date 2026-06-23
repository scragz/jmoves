# Amen Tracker — Engine & Pattern Spec

A spec for a browser Web Audio app that plays 16 equal-length Amen slices and sequences them tracker-style from JSON, with no sequencing UI. Part 1 (this doc) is the engine + data format. Part 2 reuses it as a gallery of "technique cards" — one pattern per construct, grouped by musical style.

This is a **specification**, not an implementation. Code appears only where an audio-API behaviour is a genuine gotcha and prose would be ambiguous.

---

## 0. How Part 2 constrains Part 1

Part 2 is a single static page: ~12 cards, each `{ name, description, play button }`, grouped under a heading per style (Breaks, Footwork, Gabber, Steppers). Each card is bound to one pattern JSON. That imposes five hard requirements on the engine, and they're the reason the format looks the way it does:

1. **Many players, one context.** 12 cards on a page → one shared `AudioContext` and one shared decoded-buffer pool. Never one context per card (browsers cap ~6 live contexts and each costs a hardware voice).
2. **Declarative patterns.** A card is just data + a play button. Everything musical lives in the JSON; the card carries no logic. Authoring a new technique = writing a new JSON file, never touching engine code.
3. **Per-step expressivity, not just note-on.** The constructs are about *how* a hit is placed — withheld downbeats, truncated stutters, pitch shifts, reversal, saturation, sub-anchoring. The cell format must carry those per-step, or half the constructs can't be demonstrated.
4. **Loop + one-shot, exact length.** Cards loop until stopped (these are textures, not songs). Some constructs (Temporal Foreclosure) need a multi-bar arc that *resolves at a boundary*, so loop length must be arbitrary bars, not locked to one.
5. **Graceful "gesture" mode.** Some constructs (Reserved Incompletion, Corpse Meter) are inherently about things outside the waveform. The format must let a pattern *gesture* at them (a structured gap, an annotation) without pretending to fully render them.

---

## 1. Audio assets

16 files, `audio/amen-01.wav` … `amen-16.wav`. Verified properties (identical across all 16):

| Property | Value |
|---|---|
| Format | WAV, PCM 16-bit, stereo |
| Sample rate | 48 000 Hz |
| Frames | 10 480 |
| **Duration** | **218.33 ms** each |
| Header note | Each carries a `JUNK`/`INFO` chunk with a sampler label (cosmetic; ignore) |

### Hit map (`docs/amen-samples.md`)

The 16 slices are one bar of the Amen at 16th-note resolution. Drum content per step:

| Step | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hit | kick | kick | rim | hat | snare | hat | snare | sn/kk flam | kk/sn flam | snare | hat | snare | kick | kick | rim | hat→snare* |

Functional groupings the pattern authors will lean on constantly:

- **Kicks:** 1, 2, 13, 14 (plus the flams 8, 9)
- **Snares (backbeat):** 5, 7, 10, 12 — step 5 and 13-area are the "downbeat-ish" anchors
- **Hats/ghosts:** 4, 6, 11, 16
- **Rimshots:** 3, 15
- **Flams (the money slices for chop fills):** 8, 9

> *Step 16 is labelled "hat / snare" — treat as a hat with snare bleed.*

### Tempo arithmetic (the core of the sound)

Native slice length 218.33 ms equals:

- a **16th note at 68.7 BPM** (the slice's "home" tempo — one bar of all 16 = 3.49 s), or
- an **8th note at 137.5 BPM**.

Jungle sits ~160–175 BPM. A 16th-note step at 170 BPM is **88.2 ms** — far *shorter* than the 218 ms slice. So when you sequence slices on a fast grid, **each slice is still ringing when the next step fires.** That overlap (and the choice of whether to cut the old voice or let it bleed) *is* the chopped-Amen sound. The engine's voice/gate model (§4) exists to control exactly this.

---

## 2. Architecture

```
                ┌─────────────────────────────────────────┐
                │            AudioContext (one)            │
                │                                          │
  pattern.json ─┤  BufferPool: amen-01..16 → AudioBuffer   │
   (per card)   │      (fetch+decode once, shared)         │
                │                                          │
                │  PatternPlayer (one per playing card)    │
                │    • lookahead scheduler (Web Audio clock)│
                │    • per-step → Voice(s)                  │
                │                                          │
                │  master ─→ [analyser] ─→ destination     │
                └─────────────────────────────────────────┘
```

- **BufferPool** — fetch all 16 WAVs once, `decodeAudioData`, cache as `AudioBuffer[16]`. Shared by every player. Part 2's cards never re-decode.
- **PatternPlayer** — constructed from one pattern JSON. Owns its own scheduler, transport position, and output bus (gain + optional sends). `play()` / `stop()`. Multiple can run at once but Part 2's cards are mutually exclusive by default (starting one stops others — see §7).
- **Voice** — a single triggered slice: `AudioBufferSourceNode → gain(env) → [pan] → player bus`. One-shot, disposable (Web Audio rule — see §5).
- **Extensions** (approved): a **SubVoice** synth lane and a **SaturationSend** (WaveShaper). Detailed in §4.3–4.4.

Single shared context means the user-gesture unlock (§5) happens once, on the first card's play button, and every later card is already unlocked.

---

## 3. Pattern JSON format

One file per technique, e.g. `patterns/gabber-structural-absence.json`. Tracker semantics: a pattern is a set of **lanes**, each lane is an array of **steps**, a step is a **cell**.

### 3.1 Top level

```jsonc
{
  "id": "gabber-structural-absence",
  "name": "Structural Absence",
  "style": "Gabber",            // grouping heading in Part 2
  "construct": "II",            // which ZoC construct in the source doc
  "description": "The break that never drops. Expectation is built, then the genre-promised hit is categorically withheld; you supply the groove to fill the void.",
  "bpm": 150,
  "stepsPerBar": 16,            // grid resolution (16 = 16ths; 12 = 8th-triplets; 24 = 16th-triplets)
  "bars": 4,                    // loop length; arc-based constructs use >1
  "swing": 0.0,                 // 0..1, applied to off-grid steps (16th swing)
  "loop": true,
  "lanes": [ /* see 3.2 */ ],
  "notes": "free text for the card author / future me"
}
```

`bpm × stepsPerBar` fixes the step clock. `stepDur = 60 / bpm / (stepsPerBar/4)` seconds. Total loop = `bars × stepsPerBar` steps.

### 3.2 Lanes

```jsonc
"lanes": [
  { "type": "slice", "name": "amen", "steps": [ /* cells, length = bars*stepsPerBar */ ] },
  { "type": "sub",   "name": "sub",  "steps": [ /* cells */ ] }
]
```

- `type: "slice"` — plays Amen buffers. The default and usually only lane.
- `type: "sub"` — drives the SubVoice synth (§4.3). Optional.
- Multiple `slice` lanes are allowed (e.g. a low-pitched layer under a chopped top), played polyphonically.

A lane's `steps` array length **must** equal `bars × stepsPerBar`. Authoring tip: a run-length/short form is allowed where a missing trailing array is padded with rests, but canonical files are dense arrays for diff-ability.

### 3.3 Cell

A cell is one of:

- `null` or `0` — **rest** (no trigger).
- an **integer 1–16** — trigger that slice with defaults (full slice, gain 1, no pitch shift).
- an **object** — trigger with modifiers:

```jsonc
{
  "slice": 8,          // 1–16 (slice lane) — required for slice lanes
  "gain": 0.8,         // 0..1 linear, default 1
  "rate": 1.0,         // playbackRate; pitch+speed coupled (see §5). 0.5 = octave down
  "reverse": false,    // play the reversed buffer (§5)
  "offset": 0.0,       // seconds into the slice to start (0..0.218) — for chop-into-middle
  "gate": null,        // seconds to hold before fade-out; null = full slice. THE stutter/chop control
  "pan": 0.0,          // -1..1
  "sat": 0.0,          // 0..1 send into SaturationSend (§4.4)
  "ratchet": 1,        // retrigger N times within this step (1 = none). e.g. 4 = 1/64 roll
  "prob": 1.0          // 0..1 trigger probability (for Stochastic Caesura-style density)
}
```

Sub-lane cells use `"note"` (MIDI or Hz) instead of `"slice"`; see §4.3.

### 3.4 Worked cell examples (the vocabulary Part 2 is written in)

| Intent | Cell |
|---|---|
| Plain backbeat snare | `5` |
| Ghost hat, quiet | `{ "slice": 4, "gain": 0.4 }` |
| Chopped stutter (cut slice short) | `{ "slice": 8, "gate": 0.045 }` |
| 1/64 ratchet roll on a kick | `{ "slice": 1, "ratchet": 4, "gate": 0.02 }` |
| Pitched-down "sub-ish" kick | `{ "slice": 1, "rate": 0.5 }` |
| Reverse snare lead-in | `{ "slice": 12, "reverse": true }` |
| Saturated, opaque hit | `{ "slice": 9, "sat": 0.9, "gain": 0.7 }` |
| Probabilistic fill (density haze) | `{ "slice": 6, "prob": 0.5 }` |
| Withheld downbeat (Metrical Ghost) | `null` on the strong step, dense cells around it |

This 11-field cell + lane model is the whole expressive surface. Every construct in §6 is expressed as some pattern of these cells — no per-construct engine code.

---

## 4. Engine behaviour

### 4.1 Scheduler (non-negotiable)

Use a **lookahead scheduler driven by the Web Audio clock**, not `setInterval` firing notes directly. The canonical pattern (Chris Wilson, *A Tale of Two Clocks*):

- a `setTimeout`/`setInterval` loop wakes every ~25 ms (the *lookahead*),
- it scans forward a small *schedule-ahead* window (~100 ms),
- any step whose time falls in the window is scheduled with `source.start(when)` at a precise `AudioContext.currentTime`-based timestamp.

`setInterval`-triggered `start()` calls drift and jitter audibly at 170 BPM — this is the single most common Web Audio sequencer failure. (See §5 for why this is mandatory, not stylistic.)

### 4.2 Voice + envelope

Each trigger builds a fresh graph: `AudioBufferSourceNode → GainNode → (StereoPanner) → lane bus`. Apply a **short envelope on the gain** even for "full" hits:

- attack ramp ~2 ms at the start (kills the click from starting mid-DC-offset),
- release ramp ~3–5 ms at `gate` end or slice end (kills the click from truncation).

Truncated/`gate`d hits **without** a release ramp click loudly — this is a real artifact, not optional polish (§5).

**Polyphony / voice-stealing:** default is *let voices overlap* (the bleed is the sound). Provide a per-lane cap (default ~16 voices); when exceeded, steal the oldest. A `gate` shorter than `stepDur` makes a lane effectively monophonic-staccato; a `gate` of `null` at fast tempo overlaps heavily.

### 4.3 SubVoice (extension — approved)

A simple synth lane so the two-tempo / sub-anchor constructs land. Per the docs, the sub is a slow grid (~half or quarter the drum tempo) that anchors everything above it.

- Graph: `OscillatorNode(sine|triangle) → gain(env) → lowpass(~120 Hz) → master`.
- Sub-lane cell: `{ "note": 36, "gain": 0.9, "gate": 0.4, "glide": 0.0 }` — `note` in MIDI (36 = C1) or `"hz"`; `glide` = portamento seconds.
- Authors typically place sub hits on a sparse grid (e.g. one per bar, or the classic offbeat jungle sub) while the slice lane runs dense on top. This is what makes Tempo Schism, Gravitational Liminality, and Metrical Ghost's anchor audible.

The SubVoice is deliberately minimal — it is an *anchor*, not an instrument. No filter sweeps, no FM. If a construct needs more, that's a flag, not a feature.

### 4.4 SaturationSend (extension — approved)

A shared WaveShaper send for the gabber constructs (saturation as a *compositional* tool, per `gabber.md`).

- Graph: `lane/voice → sendGain(per-cell sat) → WaveShaperNode(tanh-ish curve, oversampled '4x') → makeup gain → master`.
- `sat` on a cell sets that voice's send amount (0..1). Above ~0.6 the curve clips hard; this is the intended Percussive-Opacity / Monophonic-Polyrhythm territory.
- One shared shaper for the whole player (cheaper, and the "shared distortion bus" is sonically correct for the genre).

> **Curve note:** build the shaper curve once (a `Float32Array` tanh table); rebuilding it per trigger is a needless GC hazard. Use `oversample: '4x'` — without it, hard-clipping aliases and the result sounds digital-harsh rather than analog-brutal (a relevant distinction for gabber).

---

## 5. Web Audio gotchas (the parts that bite)

These are the implementation hazards worth fixing in the spec so Part 2 doesn't rediscover them:

1. **Autoplay unlock.** `AudioContext` starts `suspended`. It must be `resume()`d inside a user-gesture handler. Use the **first card's play button** as the unlock; the shared context stays running for all subsequent cards. Decode buffers lazily on first play, or eagerly after the unlock.

2. **`AudioBufferSourceNode` is single-use.** You cannot `start()` it twice or reuse it. Every trigger (and every `ratchet` repeat) creates a new source node. Don't try to cache source nodes — cache only the `AudioBuffer`.

3. **Scheduling must use the audio clock.** `setInterval(() => source.start(), stepMs)` drifts and jitters. Use the lookahead pattern (§4.1). Schedule `start(when)` with `when` computed from a running `nextStepTime += stepDur`, never from wall-clock or `Date.now()`.

4. **Click suppression is mandatory.** Starting a buffer mid-sample or truncating it produces a discontinuity → audible click. Always ramp gain (2 ms in / 3–5 ms out). This matters most for `gate`/`ratchet`/`offset` cells, which are exactly the chop-heavy ones Part 2 leans on.

5. **`playbackRate` couples pitch and time.** Vanilla Web Audio has **no time-stretch.** `rate: 0.5` drops an octave *and* doubles the duration. Consequences for Part 2:
   - Pitch-shifting a slice changes how long it occupies the grid (factor into `gate`/overlap).
   - **Corpse Meter** (needs pitch-shift *without* losing the original timing microstructure) can only be *approximated* — the construct is partly about what survives true time-stretch, which we don't have. Flag it (§6).

6. **Reverse needs a reversed buffer.** Negative `playbackRate` is unreliable across browsers. Pre-compute a reversed copy of each `AudioBuffer` once at load (`slice().reverse()` per channel), cache as a parallel pool. `reverse: true` reads from that pool.

7. **48 kHz assets, context may be 44.1 kHz.** `decodeAudioData` resamples to the context rate automatically — fine, but don't assume `buffer.length === 10480` downstream; derive durations from `buffer.duration`, not frame counts.

8. **Sample rate vs. `offset` precision.** `source.start(when, offset, duration)` takes seconds. Use seconds derived from `buffer.duration`, not hardcoded 0.21833, so it survives resampling.

9. **One analyser, optional.** A single master `AnalyserNode` is enough if Part 2 wants a per-card waveform/VU. Don't put an analyser per voice.

---

## 6. Construct → pattern feasibility map

All 12 constructs, how each is expressed in the format, and how fully it lands. **L** = lands (renderable as a convincing demo), **A** = approximate (audible but the construct's full claim exceeds the medium), **G** = gesture only (the format can point at it; the phenomenon lives outside the waveform).

### Breaks (`breaks.md`)

| # | Construct | Mechanism in-format | Lands |
|---|---|---|---|
| 1 | **Metrical Ghost** | Rest (`null`) on the strong beat; cluster dense cells around it; sub lane anchors the implied position. The groove pulls toward the hole. | **L** |
| 2 | **Phrase Debt** | Quote a recognizable slice run in order (e.g. 1→5), then cut before the resolving snare (12) — leave the cadence unpaid. Loop so the debt re-accrues. | **L** |
| 3 | **Corpse Meter** | Heavy `rate` shift + retained original step order; the "body" is the surviving sequence under pitch processing. *No true time-stretch* → the deeper claim can't fully render. | **A** |

### Footwork (`footwork.md`)

| # | Construct | Mechanism in-format | Lands |
|---|---|---|---|
| 1 | **Temporal Foreclosure** | Multi-bar arc (`bars: 8`): bars 1–6 a clear, lockable grid; bars 7–8 flood with `stepsPerBar: 24` triplet pressure + ratchets so the predicted grid collapses at the boundary. The collapse *is* the drop. | **L** |
| 2 | **Stochastic Caesura** | Saturate 32nd density with `prob` < 1 and randomized slice choice; extraction fails and a "rest" emerges perceptually from excess, not silence. | **L** |
| 3 | **Reserved Incompletion** | Structurally reserve a metric slot (a recurring shaped gap) the track refuses to fill — but the "dancer who completes it" is outside the waveform by definition. Format can only mark the slot. | **G** |

### Gabber (`gabber.md`)

| # | Construct | Mechanism in-format | Lands |
|---|---|---|---|
| 1 | **Percussive Opacity** | Max density slice lane + high `sat` across cells (SaturationSend) → rhythm present but unparseable. Tune `sat` to sit *at* the threshold, not past it. | **L** |
| 2 | **Structural Absence** | Build the kick expectation (steps 1,2,13,14 present for bars), then categorically withhold them; listener supplies the missing floor. Sub lane optional to deepen the promise. | **L** |
| 3 | **Monophonic Polyrhythm** | Single kick slice (1) looped 4-to-floor with heavy `sat` + slight `rate` movement; perceived parallel pulse-streams from one saturated element. The "multiple streams" claim is perceptual/somatic → can't be proven in-signal. | **A** |

### Steppers (`steppers.md`)

| # | Construct | Mechanism in-format | Lands |
|---|---|---|---|
| 1 | **Gravitational Liminality** | Sub lane carries the 4/4 pulse-as-force while the kick *slice* is withheld (present-as-force, absent-as-event). Time-budget the withhold across `bars`. Needs the SubVoice. | **L** |
| 2 | **Subdivided Relentlessness** | Locked, near-identical dense 16th Amen pattern at steppers tempo (`bpm: 130`, `bars: 8`, `swing: 0`); repetition converts subdivision into weight, not information. | **L** |
| 3 | **Structural Aliasing** | Perfectly quantized high-density slice pattern (`swing: 0`, max `stepsPerBar`); metric ambiguity emerges *despite* grid regularity. The more locked, the more it floats. | **L** |

**Tally with both extensions:** 9 **L**, 2 **A**, 1 **G**. The two **A**s (Corpse Meter, Monophonic Polyrhythm) are limited by the absence of time-stretch and by being soma-level claims, respectively — both flagged on their cards. The one **G** (Reserved Incompletion) is, per its own source doc, *constitutively* incompletable without a dancer; the honest move is a card that names that rather than faking it.

---

## 7. Part 2 wiring (so the format choices read clearly)

- **Page:** static; 4 `<section>`s (Breaks / Footwork / Gabber / Steppers), each a heading + a grid of cards.
- **Card:** `{ name, description, play/stop toggle }`, plus a small **L/A/G badge** and (for A/G) a one-line "why this is partial" note drawn from §6. Honest labelling is part of the design, not an apology.
- **Players:** one shared `AudioContext` + BufferPool; each card lazily builds its `PatternPlayer` from its JSON on first play. Default **mutual exclusion** (playing a card stops the current one) so 12 textures don't pile up — but the engine supports concurrency if a future "layer two constructs" view wants it.
- **Pattern files:** `patterns/<style>-<construct>.json`, 12 of them, each conforming to §3. Adding/altering a technique never touches engine code — the whole point of the declarative format.
- **Optional per-card analyser** for a waveform thumbnail; one master analyser is enough.

---

## 8. Open decisions / defaults (flagged, not blocking)

| Decision | Default taken | Reversible? |
|---|---|---|
| Sub & saturation extensions | **Included** (per your call) | Yes — lanes/sends are additive; strict-slice patterns ignore them |
| Pattern array form | Dense arrays (diff-friendly) over run-length | Yes — add a shorthand expander later |
| `prob` randomness seeding | Unseeded per playback (Stochastic Caesura *should* vary per listen) | Could add a `seed` field if reproducibility wanted |
| Mutual exclusion of cards | On | Trivial toggle |
| Master limiter | Add a soft `DynamicsCompressorNode` on master (gabber `sat` + overlap can clip) | Yes |
| True time-stretch (for Corpse Meter) | Out of scope (no native API; a phase-vocoder lib would be a real dependency) | Open — could add later as a 3rd extension |

---

## 9. Build order (Part 1)

1. BufferPool: fetch + decode 16 WAVs + build reversed pool.
2. PatternPlayer + lookahead scheduler + Voice/envelope (slice lane only). Validate with a plain 16-step playthrough at 68.7 BPM (should reconstruct the original bar) and at 170 BPM (should chop).
3. Cell modifiers: `gain, rate, reverse, offset, gate, pan, ratchet, prob`.
4. SubVoice lane.
5. SaturationSend + master limiter.
6. JSON loader + validation (lane length === bars×stepsPerBar).
7. Hand off to Part 2: write the 12 pattern files against §6, build the card gallery.

Verification gate before Part 2: a test page that loads one known pattern and lets me confirm scheduling tightness (no drift over 60 s), click-free truncation, and that the original-bar reconstruction is sample-correct.
```
