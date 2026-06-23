// JSON loader + validation (spec §3.2, §9.6). A lane's steps array must equal
// bars × stepsPerBar; a short array is padded with trailing rests (spec §3.2).

import type { Lane, Pattern } from "./types";

export function validatePattern(raw: unknown): Pattern {
  const p = raw as Partial<Pattern>;
  if (!p || typeof p !== "object") throw new Error("pattern is not an object");

  const require = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`pattern ${p.id ?? "?"}: ${msg}`);
  };

  require(typeof p.id === "string", "missing id");
  require(typeof p.name === "string", "missing name");
  require(typeof p.style === "string", "missing style");
  require(typeof p.bpm === "number" && p.bpm > 0, "invalid bpm");
  require(
    typeof p.stepsPerBar === "number" && p.stepsPerBar > 0,
    "invalid stepsPerBar",
  );
  require(typeof p.bars === "number" && p.bars > 0, "invalid bars");
  require(Array.isArray(p.lanes) && p.lanes.length > 0, "missing lanes");

  const total = p.bars! * p.stepsPerBar!;
  const lanes: Lane[] = (p.lanes as Lane[]).map((lane, i) => {
    require(
      lane.type === "slice" || lane.type === "sub",
      `lane ${i} has invalid type`,
    );
    require(Array.isArray(lane.steps), `lane ${i} missing steps`);
    if (lane.steps.length > total) {
      throw new Error(
        `pattern ${p.id}: lane ${i} has ${lane.steps.length} steps, expected ${total}`,
      );
    }
    // pad short-form trailing rests
    const steps = lane.steps.slice();
    while (steps.length < total) steps.push(null);
    return { ...lane, steps } as Lane;
  });

  return {
    id: p.id!,
    name: p.name!,
    style: p.style!,
    construct: p.construct,
    description: p.description ?? "",
    bpm: p.bpm!,
    stepsPerBar: p.stepsPerBar!,
    bars: p.bars!,
    swing: p.swing ?? 0,
    loop: p.loop ?? true,
    lanes,
    lands: p.lands,
    partial: p.partial,
    notes: p.notes,
  };
}
