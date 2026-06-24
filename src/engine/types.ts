// Pattern JSON format — see docs/sequencer-spec.md §3.

/** Lands quality badge from the construct → feasibility map (spec §6). */
export type Lands = "L" | "A" | "G";

/** A slice-lane cell with modifiers (spec §3.3). */
export interface SliceCellObject {
  /** 1–16 — which Amen slice. Required for slice lanes. */
  slice: number;
  /** 0..1 linear gain, default 1. */
  gain?: number;
  /** playbackRate; pitch + speed coupled. 0.5 = octave down. Default 1. */
  rate?: number;
  /** play the reversed buffer. Default false. */
  reverse?: boolean;
  /** seconds into the slice to start (0..~0.218). Default 0. */
  offset?: number;
  /** seconds to hold before fade-out; null = full slice. The stutter/chop control. */
  gate?: number | null;
  /** -1..1 stereo pan. Default 0. */
  pan?: number;
  /** 0..1 send into the SaturationSend. Default 0. */
  sat?: number;
  /** retrigger N times within this step (1 = none). e.g. 4 = 1/64 roll. */
  ratchet?: number;
  /** 0..1 trigger probability. Default 1. */
  prob?: number;
}

/** A sub-lane cell drives the SubVoice synth (spec §4.3). */
export interface SubCellObject {
  /** MIDI note number, or a string in Hz ("55hz"). */
  note: number | string;
  /** 0..1 linear gain, default 0.9. */
  gain?: number;
  /** seconds to hold before fade-out. Default = most of the step. */
  gate?: number | null;
  /** portamento seconds from the previous note. Default 0. */
  glide?: number;
  /** 0..1 trigger probability. Default 1. */
  prob?: number;
}

export type SliceCell = null | 0 | number | SliceCellObject;
export type SubCell = null | 0 | SubCellObject;

export interface SliceLane {
  type: "slice";
  name: string;
  steps: SliceCell[];
}

export interface SubLane {
  type: "sub";
  name: string;
  steps: SubCell[];
}

export type Lane = SliceLane | SubLane;

export interface Pattern {
  id: string;
  name: string;
  /** grouping heading in Part 2: Breaks | Footwork | Gabber | Steppers */
  style: string;
  /** which construct in the source doc, e.g. "I" / "II". */
  construct?: string;
  description: string;
  bpm: number;
  /** grid resolution: 16 = 16ths, 12 = 8th-triplets, 24 = 16th-triplets. */
  stepsPerBar: number;
  /** loop length in bars; arc-based constructs use >1. */
  bars: number;
  /** 0..1 swing applied to off-grid steps. Default 0. */
  swing?: number;
  loop?: boolean;
  lanes: Lane[];
  /** L / A / G feasibility badge (spec §6). */
  lands?: Lands;
  /** one-line "why this is partial" note for A / G cards. */
  partial?: string;
  /** free text for the card author / future me. */
  notes?: string;
}
