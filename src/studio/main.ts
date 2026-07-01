/**
 * gosfuig studio — interactive front-end.
 *
 * UI + state only. All color math is delegated to the real library in ../.
 *
 * Model: a family is either "from color" (a fixed seed color drives its hue —
 * and, by default, its chroma — via seedFamily) or "free hue" (a hue slider
 * drives it). Each family carries its own lightness ramp, chroma shape, and
 * hue torsion, edited in a collapsible curves panel. Step count is palette-wide.
 *
 * Rendering: controls are built ONCE and persist; slider input mutates state
 * and calls a lightweight refresh() that recomputes derived views (swatches,
 * contract badge, grid) into existing nodes, so the slider you are dragging is
 * never recreated. Structural changes (add/remove family, change step count) do
 * a full remount.
 */
import './studio.css';
import { seedFamily, resolveFamily, type FamilySpec, type Family } from '../family.js';
import { ramp, bump, hueRamp } from '../curves.js';
import { makeScale } from '../naming.js';
import { checkContract, contrastMatrix, contractRegion } from '../validate.js';
import { toW3CTokens } from '../export/w3c.js';
import { parse, toHex } from '../color/oklch.js';

// ---- studio state (declarative; fed straight into the library) ----
type Mode = 'seed' | 'free';
interface FamilyState {
  name: string;
  mode: Mode;
  // free-hue mode
  hue: number;
  // from-color mode
  seed: string; // hex
  seedStep: number; // index into the current scale
  chromaAuto: boolean; // seed drives chroma
  // chroma peak + shape
  chroma: number;
  tPeak: number;
  chromaLight: number;
  chromaDark: number;
  // hue torsion (degrees across the ramp)
  hueTorsion: number;
  // per-family lightness ramp
  lightMax: number;
  lightMin: number;
  gamma: number;
  sCurve: number;
}

const LIGHT_DEFAULT = { lightMax: 0.98, lightMin: 0.18, gamma: 1.0, sCurve: 0.13 };
const CHROMA_DEFAULT = { chroma: 0.14, tPeak: 0.6, chromaLight: 0.025, chromaDark: 0.05 };

function mkFamily(over: Partial<FamilyState>): FamilyState {
  return {
    name: 'family',
    mode: 'seed',
    hue: 259,
    seed: '#1d4ed8',
    seedStep: 6,
    chromaAuto: true,
    hueTorsion: 0,
    ...LIGHT_DEFAULT,
    ...CHROMA_DEFAULT,
    ...over,
  };
}

let steps = 12; // palette-wide step count
let openGrid = -1; // index of the family whose contrast grid is expanded (-1 = none)

const families: FamilyState[] = [
  mkFamily({ name: 'blue', seed: '#1d4ed8', seedStep: 8 }),
  mkFamily({ name: 'green', seed: '#059669', seedStep: 7 }),
  mkFamily({ name: 'amber', seed: '#d97706', seedStep: 7 }),
  mkFamily({ name: 'red', seed: '#e11d48', seedStep: 6 }),
  mkFamily({ name: 'violet', seed: '#7c3aed', seedStep: 6 }),
  mkFamily({ name: 'gray', seed: '#6b7280', seedStep: 6 }),
];

// ---- bridge studio state -> library FamilySpec ----
function lightnessOf(f: FamilyState) {
  return ramp({ max: f.lightMax, min: f.lightMin, gamma: f.gamma, sCurve: f.sCurve });
}
function chromaCurveOf(f: FamilyState) {
  return bump({ peak: f.chroma, tPeak: f.tPeak, light: f.chromaLight, dark: f.chromaDark });
}
function toSpec(f: FamilyState): FamilySpec {
  const lightness = lightnessOf(f);
  if (f.mode === 'seed') {
    return seedFamily({
      name: f.name,
      seed: f.seed,
      step: Math.min(f.seedStep, steps - 1),
      steps,
      hueTorsion: f.hueTorsion,
      lightness,
      chroma: f.chromaAuto ? undefined : chromaCurveOf(f),
    });
  }
  const hue =
    f.hueTorsion !== 0 ? hueRamp(f.hue - f.hueTorsion / 2, f.hue + f.hueTorsion / 2) : f.hue;
  return { name: f.name, hue, chroma: chromaCurveOf(f), lightness, steps };
}

// ---- tiny DOM helper ----
type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
function el(tag: string, attrs: Attrs = {}, kids: (Node | string | null)[] = []): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false) e.setAttribute(k, String(v));
  }
  for (const c of kids) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

/** A persistent slider whose input never triggers its own recreation. */
function slider(
  cls: string, label: string, val: number, min: number, max: number, step: number,
  fmt: (v: number) => string, on: (v: number) => void,
): { root: HTMLElement; input: HTMLInputElement } {
  const out = el('b', {}, [fmt(val)]);
  const input = el('input', {
    type: 'range', min, max, step, value: val,
    oninput: (e) => { const v = +(e.target as HTMLInputElement).value; out.textContent = fmt(v); on(v); },
  }) as HTMLInputElement;
  const root = el('div', { class: cls }, [el('label', {}, [label, out]), input]);
  return { root, input };
}

// ---- persistent shell ----
const app = document.getElementById('app')!;
const summaryEl = el('span', { class: 'pill' });
const famHost = el('div', { class: 'fam-host' });
const outEl = el('div', { id: 'out' });
interface Card { el: HTMLElement; refresh: () => void; }
let cards: Card[] = [];

function mount(): void {
  app.innerHTML = '';

  // global controls
  const stepCtrl = slider('ctrl', 'steps', steps, 5, 16, 1, (v) => String(v), (v) => {
    steps = v;
    for (const f of families) f.seedStep = Math.min(f.seedStep, steps - 1);
    remountFamilies();
  });
  app.append(el('div', { class: 'globals' }, [stepCtrl.root]));

  app.append(el('div', { class: 'summary' }, [
    summaryEl,
    el('span', { class: 'legend' }, ['contract = darkest steps readable (WCAG AA ≥ 4.5) on the lightest']),
  ]));

  app.append(famHost);

  app.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn add', onclick: addFamily }, ['+ add family']),
    el('button', { class: 'btn', onclick: showTokens }, ['export W3C tokens']),
    el('span', { class: 'legend' }, ['click any swatch to toggle its contrast grid']),
  ]));
  app.append(outEl);

  remountFamilies();
}

function remountFamilies(): void {
  if (openGrid >= families.length) openGrid = -1;
  cards = families.map((_, i) => buildCard(i));
  famHost.replaceChildren(...cards.map((c) => c.el));
  refreshAll();
}

function refreshAll(): void {
  cards.forEach((c) => c.refresh());
  updateSummary();
}

function updateSummary(): void {
  const passed = families.filter((f) => checkContract(resolveFamily(toSpec(f))).passes).length;
  const total = families.length;
  const ok = passed === total;
  summaryEl.className = 'pill ' + (ok ? 'ok' : passed === 0 ? 'bad' : 'warn');
  summaryEl.textContent = `${passed} / ${total} families pass`;
}

// ---- one family card ----
function buildCard(fi: number): Card {
  const fam = families[fi]!;
  const scale = makeScale(steps);
  const strip = el('div', { class: 'strip' });
  const badge = el('span', { class: 'status' });
  const gridHost = el('div', { class: 'grid-host' });

  // A single-family change can flip its own pass state, so keep the summary live.
  const refreshSelf = () => { refresh(); updateSummary(); };

  const nameInput = el('input', {
    type: 'text', value: fam.name, 'aria-label': 'family name',
    oninput: (e) => { fam.name = (e.target as HTMLInputElement).value; },
  });

  // hue source: from-color (seed) or free hue
  const modeSel = el('select', {
    'aria-label': 'hue source', class: 'mode',
    onchange: (e) => { fam.mode = (e.target as HTMLSelectElement).value as Mode; sync(); refreshSelf(); },
  }) as HTMLSelectElement;
  modeSel.append(
    el('option', { value: 'seed', selected: fam.mode === 'seed' }, ['from color']),
    el('option', { value: 'free', selected: fam.mode === 'free' }, ['free hue']),
  );

  // --- from-color controls ---
  const seedColor = el('input', {
    type: 'color', 'aria-label': 'base color', value: normalizeHex(fam.seed),
    oninput: (e) => { fam.seed = (e.target as HTMLInputElement).value; refreshSelf(); },
  }) as HTMLInputElement;
  const seedStepSel = el('select', {
    'aria-label': 'pin step',
    onchange: (e) => { fam.seedStep = +(e.target as HTMLSelectElement).value; refreshSelf(); },
  }) as HTMLSelectElement;
  scale.names.forEach((n, i) =>
    seedStepSel.append(el('option', { value: i, selected: i === Math.min(fam.seedStep, steps - 1) }, ['pin ' + n])));
  const seedCtrls = el('div', { class: 'seed-only src' }, [
    el('label', { class: 'srclab' }, ['color']), seedColor, seedStepSel,
  ]);

  // --- free-hue controls ---
  const hue = slider('mini', 'hue', fam.hue, 0, 360, 1, (v) => `${v}°`, (v) => { fam.hue = v; refreshSelf(); });
  const freeCtrls = el('div', { class: 'free-only' }, [hue.root]);

  // --- chroma peak (+ auto toggle for seed mode) ---
  const chroma = slider('mini', 'chroma', fam.chroma, 0, 0.3, 0.005, (v) => v.toFixed(3), (v) => { fam.chroma = v; refreshSelf(); });
  const autoChk = el('input', {
    type: 'checkbox', checked: fam.chromaAuto, 'aria-label': 'auto chroma from color',
    onchange: (e) => { fam.chromaAuto = (e.target as HTMLInputElement).checked; sync(); refreshSelf(); },
  }) as HTMLInputElement;
  const autoWrap = el('label', { class: 'seed-only chk', title: 'derive chroma from the base color' }, [autoChk, 'auto']);

  const curvesBtn = el('button', { class: 'btn icon', 'aria-label': 'toggle curves', title: 'curve controls' }, ['⚙']);

  const top = el('div', { class: 'fam-top' }, [
    nameInput, modeSel, seedCtrls, freeCtrls, chroma.root, autoWrap, badge,
    curvesBtn,
    el('button', { class: 'btn icon remove', 'aria-label': 'remove family', title: 'remove family', onclick: () => removeFamily(fi) }, ['✕']),
  ]);

  // ---- curves panel (persistent; toggled by class) ----
  const lMax = slider('mini', 'L max', fam.lightMax, 0.9, 0.995, 0.005, (v) => v.toFixed(3), (v) => { fam.lightMax = v; refreshSelf(); });
  const lMin = slider('mini', 'L min', fam.lightMin, 0.08, 0.35, 0.005, (v) => v.toFixed(3), (v) => { fam.lightMin = v; refreshSelf(); });
  const gam = slider('mini', 'gamma', fam.gamma, 0.6, 1.6, 0.05, (v) => v.toFixed(2), (v) => { fam.gamma = v; refreshSelf(); });
  const sc = slider('mini', 'S-curve', fam.sCurve, 0, 0.5, 0.01, (v) => v.toFixed(2), (v) => { fam.sCurve = v; refreshSelf(); });
  const tors = slider('mini', 'hue torsion', fam.hueTorsion, -60, 60, 1, (v) => `${v}°`, (v) => { fam.hueTorsion = v; refreshSelf(); });
  const tPk = slider('mini', 'chroma peak @', fam.tPeak, 0.2, 0.9, 0.05, (v) => v.toFixed(2), (v) => { fam.tPeak = v; refreshSelf(); });
  const cLo = slider('mini', 'chroma light', fam.chromaLight, 0, 0.1, 0.005, (v) => v.toFixed(3), (v) => { fam.chromaLight = v; refreshSelf(); });
  const cHi = slider('mini', 'chroma dark', fam.chromaDark, 0, 0.1, 0.005, (v) => v.toFixed(3), (v) => { fam.chromaDark = v; refreshSelf(); });
  const copyBtn = el('button', { class: 'btn', onclick: () => copyCurvesToAll(fi) }, ['copy curves → all']);

  const curves = el('div', { class: 'curves' }, [
    el('div', { class: 'curve-group' }, [el('span', { class: ' glab' }, ['lightness']), lMax.root, lMin.root, gam.root, sc.root]),
    el('div', { class: 'curve-group' }, [el('span', { class: ' glab' }, ['chroma shape']), tPk.root, cLo.root, cHi.root]),
    el('div', { class: 'curve-group' }, [el('span', { class: ' glab' }, ['hue']), tors.root]),
    el('div', { class: 'curve-group' }, [copyBtn]),
  ]);
  curvesBtn.addEventListener('click', () => root.classList.toggle('open-curves'));

  const root = el('div', { class: 'fam' }, [top, curves, strip, gridHost]);
  root.dataset.mode = fam.mode;

  /** Enable/disable + show/hide controls that depend on mode / auto-chroma. */
  function sync(): void {
    root.dataset.mode = fam.mode;
    const chromaLocked = fam.mode === 'seed' && fam.chromaAuto;
    chroma.input.disabled = chromaLocked;
    for (const s of [tPk.input, cLo.input, cHi.input]) s.disabled = chromaLocked;
    autoChk.checked = fam.chromaAuto;
  }

  function refresh(): void {
    const family = resolveFamily(toSpec(fam));
    const c = checkContract(family);
    const region = contractRegion(family.swatches.length);

    strip.style.gridTemplateColumns = `repeat(${family.swatches.length}, 1fr)`;
    strip.replaceChildren(...family.swatches.map((s) => {
      const ink = s.oklch.l > 0.6 ? '#15171a' : '#fff';
      return el('div', {
        class: 'sw' + (s.locked ? ' locked' : ''),
        style: `background:${s.hex};color:${ink}`,
        title: `${s.name} · ${s.hex} · L ${s.oklch.l.toFixed(2)} C ${s.oklch.c.toFixed(3)} H ${s.oklch.h.toFixed(0)}`,
        onclick: () => { openGrid = openGrid === fi ? -1 : fi; refreshAll(); },
      }, [el('span', { class: 'n' }, [s.name + (s.locked ? ' ★' : '')]), el('span', { class: 'h' }, [s.hex])]);
    }));

    badge.className = 'status ' + (c.passes ? 'ok' : 'bad');
    badge.textContent = `${c.passes ? 'PASS' : 'FAIL ×' + c.failures.length} · worst ${c.worst.fg.name}/${c.worst.bg.name} ${c.worst.contrast.wcag.toFixed(2)}`;

    gridHost.replaceChildren(openGrid === fi ? gridFor(family, region) : el('span'));
  }

  sync();
  refresh();
  return { el: root, refresh };
}

function gridFor(family: Family, region: { light: number[]; dark: number[] }): HTMLElement {
  const m = contrastMatrix(family);
  const sw = family.swatches;
  const t = el('table', { class: 'grid' });
  t.append(el('tr', {}, [el('th', {}, ['fg\\bg']), ...sw.map((s) => el('th', {}, [s.name]))]));
  sw.forEach((fg, r) => {
    const tr = el('tr', {}, [el('th', {}, [fg.name])]);
    sw.forEach((bg, c) => {
      const v = m[r]![c]!;
      const isC = region.dark.includes(r) && region.light.includes(c);
      tr.append(el('td', {
        class: 'cell' + (isC ? ' contract' : ''),
        style: `background:${bg.hex};color:${fg.hex}`,
        title: `WCAG ${v.wcag.toFixed(2)} · APCA ${v.apca.toFixed(0)}`,
      }, [el('span', { class: 's' }, ['Aa']), el('span', { class: 'm' }, [`${v.wcag.toFixed(1)} / ${v.apca.toFixed(0)}`])]));
    });
    t.append(tr);
  });
  return t;
}

// ---- structural actions ----
function addFamily(): void {
  families.push(mkFamily({ name: `family ${families.length + 1}`, seed: '#3b82f6', seedStep: Math.min(6, steps - 1) }));
  openGrid = -1;
  remountFamilies();
}
function removeFamily(fi: number): void {
  families.splice(fi, 1);
  if (openGrid === fi) openGrid = -1;
  else if (openGrid > fi) openGrid -= 1;
  remountFamilies();
}
function copyCurvesToAll(fi: number): void {
  const src = families[fi]!;
  for (const f of families) {
    if (f === src) continue;
    f.lightMax = src.lightMax; f.lightMin = src.lightMin; f.gamma = src.gamma; f.sCurve = src.sCurve;
    f.tPeak = src.tPeak; f.chromaLight = src.chromaLight; f.chromaDark = src.chromaDark;
    f.hueTorsion = src.hueTorsion;
  }
  remountFamilies();
}

let lastTokenUrl: string | null = null;
function showTokens(): void {
  const palette = { name: 'gosfuig studio', families: families.map((f) => resolveFamily(toSpec(f))) };
  const json = JSON.stringify(toW3CTokens(palette), null, 2);
  outEl.innerHTML = '';
  if (lastTokenUrl) { URL.revokeObjectURL(lastTokenUrl); lastTokenUrl = null; }
  try {
    lastTokenUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    outEl.append(el('a', { class: 'btn', href: lastTokenUrl, download: 'tokens.json', style: 'display:inline-block;margin-bottom:8px' }, ['⬇ download tokens.json']));
  } catch { /* download unavailable in sandbox */ }
  outEl.append(el('pre', {}, [json]));
}

/** Coerce any CSS color to a #rrggbb the <input type=color> accepts. */
function normalizeHex(hex: string): string {
  try { return toHex(parse(hex)); } catch { return '#888888'; }
}

mount();
