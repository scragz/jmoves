// Part 2 — the gallery of technique cards (spec §7). Each card is { name,
// description, play/stop toggle } + an L/A/G badge, grouped under a per-style
// heading. The card carries no logic; everything musical lives in the JSON.

import type { AudioEngine } from "../engine/audioEngine";
import type { Lands, Pattern } from "../engine/types";

const STYLE_ORDER = ["Breaks", "Footwork", "Gabber", "Steppers"];

const BADGE: Record<Lands, { label: string; cls: string; title: string }> = {
  L: { label: "Lands", cls: "badge-success", title: "Renderable as a convincing demo." },
  A: {
    label: "Approx",
    cls: "badge-warning",
    title: "Audible, but the construct's full claim exceeds the medium.",
  },
  G: {
    label: "Gesture",
    cls: "badge-ghost",
    title: "The format points at it; the phenomenon lives outside the waveform.",
  },
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function renderGallery(
  root: HTMLElement,
  engine: AudioEngine,
  patterns: Pattern[],
): void {
  // group + order by style
  const byStyle = new Map<string, Pattern[]>();
  for (const p of patterns) {
    const list = byStyle.get(p.style) ?? [];
    list.push(p);
    byStyle.set(p.style, list);
  }
  const styles = [
    ...STYLE_ORDER.filter((s) => byStyle.has(s)),
    ...[...byStyle.keys()].filter((s) => !STYLE_ORDER.includes(s)),
  ];

  // track the currently active toggle so mutual exclusion resets the old button
  let activeReset: (() => void) | null = null;

  for (const style of styles) {
    const section = el("section", "mb-10");
    section.appendChild(el("h2", "text-2xl font-bold mb-4 text-primary", style));
    const grid = el("div", "amen-grid");
    section.appendChild(grid);

    const list = byStyle.get(style)!;
    list.sort((a, b) => (a.construct ?? "").localeCompare(b.construct ?? ""));
    for (const pattern of list) {
      grid.appendChild(buildCard(pattern, engine, {
        onPlay: (reset) => {
          if (activeReset && activeReset !== reset) activeReset();
          activeReset = reset;
        },
        onStop: (reset) => {
          if (activeReset === reset) activeReset = null;
        },
      }));
    }
    root.appendChild(section);
  }
}

interface CardHooks {
  onPlay: (reset: () => void) => void;
  onStop: (reset: () => void) => void;
}

function buildCard(pattern: Pattern, engine: AudioEngine, hooks: CardHooks): HTMLElement {
  const card = el("div", "card bg-base-200 shadow-md border border-base-300");
  const body = el("div", "card-body gap-3");

  const header = el("div", "flex items-start justify-between gap-2");
  const titleWrap = el("div");
  titleWrap.appendChild(el("h3", "card-title text-lg", pattern.name));
  const meta = el(
    "div",
    "text-xs opacity-60",
    `${pattern.bpm} BPM · ${pattern.bars} bar${pattern.bars > 1 ? "s" : ""} · ${pattern.stepsPerBar}/bar`,
  );
  titleWrap.appendChild(meta);
  header.appendChild(titleWrap);

  if (pattern.lands) {
    const b = BADGE[pattern.lands];
    const badge = el("span", `badge ${b.cls} badge-sm`, b.label);
    badge.title = b.title;
    header.appendChild(badge);
  }
  body.appendChild(header);

  body.appendChild(el("p", "text-sm opacity-80", pattern.description));

  if ((pattern.lands === "A" || pattern.lands === "G") && pattern.partial) {
    const note = el("p", "text-xs italic opacity-60", `⚠ ${pattern.partial}`);
    body.appendChild(note);
  }

  const actions = el("div", "card-actions justify-end mt-1");
  const button = el("button", "btn btn-primary btn-sm", "▶ Play");
  let playing = false;

  const reset = () => {
    playing = false;
    button.textContent = "▶ Play";
    button.classList.remove("btn-error");
    button.classList.add("btn-primary");
  };

  button.addEventListener("click", async () => {
    if (playing) {
      engine.stop(pattern);
      reset();
      hooks.onStop(reset);
      return;
    }
    button.disabled = true;
    try {
      await engine.play(pattern, () => {
        reset();
        hooks.onStop(reset);
      });
      playing = true;
      button.textContent = "■ Stop";
      button.classList.remove("btn-primary");
      button.classList.add("btn-error");
      hooks.onPlay(reset);
    } catch (err) {
      console.error(err);
    } finally {
      button.disabled = false;
    }
  });

  actions.appendChild(button);
  body.appendChild(actions);
  card.appendChild(body);
  return card;
}
