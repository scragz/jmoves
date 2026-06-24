import { AudioEngine } from "./engine/audioEngine";
import { validatePattern } from "./engine/loader";
import type { Pattern } from "./engine/types";
import "./styles.css";
import { renderGallery } from "./ui/gallery";
import { startWaveform } from "./ui/waveform";

// --- audio assets: amen-01..16.wav, resolved to bundled URLs (spec §1, §5.7) --
const audioModules = import.meta.glob("/audio/amen-*.wav", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const audioUrls = Object.entries(audioModules)
  .map(([path, url]) => {
    const m = path.match(/amen-(\d+)\.wav$/);
    return m ? { n: parseInt(m[1], 10), url } : null;
  })
  .filter((x): x is { n: number; url: string } => x !== null)
  .sort((a, b) => a.n - b.n)
  .map((x) => x.url);

// --- pattern files: patterns/<style>-<construct>.json (spec §3, §7) -----------
const patternModules = import.meta.glob("/patterns/*.json", {
  eager: true,
}) as Record<string, { default: unknown }>;

const patterns: Pattern[] = Object.values(patternModules)
  .map((m) => {
    try {
      return validatePattern(m.default);
    } catch (err) {
      console.error(err);
      return null;
    }
  })
  .filter((p): p is Pattern => p !== null);

// --- page scaffold ------------------------------------------------------------
function buildPage(): void {
  const engine = new AudioEngine(audioUrls);

  const app = document.createElement("div");
  app.className = "max-w-6xl mx-auto p-6";

  const header = document.createElement("header");
  header.className = "mb-8 mt-[120px]";
  header.innerHTML = `
    <h1 class="text-4xl font-black tracking-tight">JUNGLE MOVES</h1>
    <p class="opacity-70 mt-1">
      Hybrid jungle techniques to challenge listeners.
    </p>
  `;

  const canvas = document.createElement("canvas");
  canvas.className = "w-full max-w-6xl h-20 mt-4 rounded-full bg-base-300 text-secondary shadow-md fixed z-10";
  app.appendChild(canvas);
  app.appendChild(header);

  const gallery = document.createElement("main");
  app.appendChild(gallery);
  document.body.appendChild(app);

  renderGallery(gallery, engine, patterns);
  startWaveform(engine.analyser, canvas);
}

buildPage();
