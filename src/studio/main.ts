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
 * and calls a lightweight refresh() that recomputes derived views into existing
 * nodes, so the slider you are dragging is never recreated. Structural changes
 * (add/remove family, change step count) do a full remount.
 */
import './studio.css';
import { resolveFamily, chromaLoss, type Family } from '../family.js';
import { makeScale } from '../naming.js';
import {
  checkContract,
  contrastMatrix,
  contractRegion,
  summarizeNotes,
  MINOR_CHROMA_LOSS,
} from '../validate.js';
import { toW3CTokens } from '../export/w3c.js';
import { parse, toHex } from '../color/oklch.js';
import { stringifyConfig, parseConfig } from '../config.js';
import { BUILTIN_TEMPLATES, findTemplate, type Template } from '../template.js';
import type { W3CExportOptions } from '../export/w3c.js';
import {
  type FamilyState,
  type Mode,
  mkFamily,
  defaultFamilies,
  DEFAULT_STEPS,
  toSpec as familyToSpec,
  toConfig,
  fromConfig,
  saveSession,
  loadSession,
  type StudioSession,
} from './model.js';

// ---- studio state ----
// The document model, the spec bridge and persistence all live in ./model.ts;
// this file is UI. A restored session wins over the built-in demo palette.
const restored = loadSession();

let steps = restored?.steps ?? DEFAULT_STEPS; // palette-wide step count
let openGrid = -1; // index of the family whose contrast grid is expanded (-1 = none)
let exportFmt: 'hex' | 'oklch' = 'hex';
let paletteName = 'gosfuig studio';
/** Token shape from an imported config. No UI yet; carried so it survives. */
let exportShape: W3CExportOptions | undefined = restored?.export;

const families: FamilyState[] = restored?.families ?? defaultFamilies();

const toSpec = (f: FamilyState) => familyToSpec(f, steps);

/** Persist after edits, coalesced so dragging a slider doesn't thrash storage. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSession({ steps, families, export: exportShape }), 250);
}

/** Replace the whole session (import, or reset). */
function adoptSession(next: StudioSession): void {
  steps = next.steps;
  exportShape = next.export;
  families.splice(0, families.length, ...next.families);
  openGrid = -1;
  scheduleSave();
  mount();
}

// ---- tiny DOM helper ----
type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
function el(tag: string, attrs: Attrs = {}, kids: (Node | string | null)[] = []): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function')
      e.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false) e.setAttribute(k, String(v));
  }
  for (const c of kids)
    if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

/** A persistent stacked slider (label above, value at right). */
function slider(
  cls: string,
  label: string,
  val: number,
  min: number,
  max: number,
  step: number,
  fmt: (v: number) => string,
  on: (v: number) => void,
): { root: HTMLElement; input: HTMLInputElement } {
  const out = el('b', {}, [fmt(val)]);
  const input = el('input', {
    type: 'range',
    min,
    max,
    step,
    value: val,
    oninput: (e) => {
      const v = +(e.target as HTMLInputElement).value;
      out.textContent = fmt(v);
      on(v);
    },
  }) as HTMLInputElement;
  const root = el('div', { class: cls }, [el('label', {}, [label, out]), input]);
  return { root, input };
}

/** A persistent inline slider (label · slider · value on one row). */
function inlineSlider(
  label: string,
  val: number,
  min: number,
  max: number,
  step: number,
  fmt: (v: number) => string,
  on: (v: number) => void,
): { root: HTMLElement; input: HTMLInputElement } {
  const out = el('b', {}, [fmt(val)]);
  const input = el('input', {
    type: 'range',
    min,
    max,
    step,
    value: val,
    oninput: (e) => {
      const v = +(e.target as HTMLInputElement).value;
      out.textContent = fmt(v);
      on(v);
    },
  }) as HTMLInputElement;
  const root = el('div', { class: 'chroma-inline' }, [el('label', {}, [label]), input, out]);
  return { root, input };
}

// ---- persistent shell ----
const app = document.getElementById('app')!;
const summaryEl = el('span', { class: 'pill' });
const famHost = el('div', { class: 'fam-host' });
const outEl = el('div', { id: 'out' });
/** Status line for config import/export — errors land here, not in an alert. */
const configNote = el('div', { class: 'config-note' });
const configInput = el('input', {
  type: 'file',
  accept: '.json,application/json',
  class: 'hidden-file',
  'aria-label': 'load palette config',
  onchange: (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void loadConfigFile(file);
    input.value = ''; // so re-picking the same file fires again
  },
}) as HTMLInputElement;

function note(message: string, kind: 'ok' | 'bad' = 'ok'): void {
  configNote.className = 'config-note ' + kind;
  configNote.textContent = message;
}

// ---- config import / export ----
let lastConfigUrl: string | null = null;

function saveConfig(): void {
  const text = stringifyConfig(toConfig({ steps, families, export: exportShape }, paletteName));
  if (lastConfigUrl) URL.revokeObjectURL(lastConfigUrl);
  lastConfigUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a', { href: lastConfigUrl, download: 'palette.config.json' }) as HTMLAnchorElement;
  a.click();
  note(
    `saved palette.config.json — ${families.length} families, ${steps} steps. ` +
      `Run it with: gosfuig palette.config.json`,
  );
}

async function loadConfigFile(file: File): Promise<void> {
  try {
    const spec = parseConfig(await file.text(), file.name);
    const session = fromConfig(spec);
    paletteName = spec.name ?? paletteName;
    adoptSession(session);
    note(`loaded ${file.name} — ${session.families.length} families, ${session.steps} steps`);
  } catch (err) {
    note(err instanceof Error ? err.message : String(err), 'bad');
  }
}

/**
 * House-style picker.
 *
 * The CLI applies a template as a base the config overrides; here it has to be
 * an edit, because a studio family always carries explicit curves and a silent
 * base would change nothing at all. So this writes the template's values into
 * every family, visibly, and says what it did.
 */
function templatePicker(): HTMLElement {
  const sel = el('select', { 'aria-label': 'apply a house style' }) as HTMLSelectElement;
  sel.append(el('option', { value: '' }, ['house style…']));
  for (const t of BUILTIN_TEMPLATES) {
    sel.append(el('option', { value: t.name, title: t.description ?? '' }, [t.name]));
  }
  sel.addEventListener('change', () => {
    const t = findTemplate(sel.value);
    sel.value = '';
    if (!t) return;
    applyTemplateToState(t);
    note(`applied "${t.name}" to all ${families.length} families — ${t.description ?? ''}`);
  });
  return sel;
}

/** Write a template's policy into every family's sliders. */
function applyTemplateToState(t: Template): void {
  if (t.steps !== undefined) steps = t.steps;
  for (const f of families) {
    if (t.lightness?.kind === 'ramp') {
      f.lightMax = t.lightness.max;
      f.lightMin = t.lightness.min;
      f.gamma = t.lightness.gamma ?? 1;
      f.sCurve = t.lightness.sCurve ?? 0;
    }
    if (t.chroma !== undefined && typeof t.chroma !== 'number' && t.chroma.kind === 'bump') {
      f.chroma = t.chroma.peak;
      f.tPeak = t.chroma.tPeak ?? f.tPeak;
      f.chromaLight = t.chroma.light ?? f.chromaLight;
      f.chromaDark = t.chroma.dark ?? f.chromaDark;
      f.chromaAuto = false;
    } else if (typeof t.chroma === 'number') {
      f.chroma = t.chroma;
      f.chromaAuto = false;
    }
  }
  if (t.export !== undefined) exportShape = t.export;
  openGrid = -1;
  scheduleSave();
  mount();
}

function resetSession(): void {
  paletteName = 'gosfuig studio';
  adoptSession({ steps: DEFAULT_STEPS, families: defaultFamilies(), export: undefined });
  note('reset to the default palette');
}

// ---- family cards ----
interface Card {
  el: HTMLElement;
  refresh: () => void;
}
let cards: Card[] = [];

function mount(): void {
  app.innerHTML = '';

  // Sticky action bar. Everything here is something you reach for repeatedly
  // while working, so it follows you down the page; the intro above it scrolls
  // away. The config note lives inside the bar, next to the buttons that
  // produce it, but bounded in height so a long validation error cannot grow
  // the header without limit.
  app.append(
    el('div', { class: 'bar' }, [
      el('div', { class: 'bar-row' }, [
        summaryEl,
        el('span', { class: 'gap' }),
        templatePicker(),
        el('button', { class: 'btn add', onclick: addFamily }, ['+ family']),
        el(
          'button',
          {
            class: 'btn',
            title: 'download this session as palette.config.json',
            onclick: saveConfig,
          },
          ['save ↓'],
        ),
        el(
          'button',
          { class: 'btn', title: 'load a palette.config.json', onclick: () => configInput.click() },
          ['load ↑'],
        ),
        el('button', { class: 'btn', title: 'discard and start over', onclick: resetSession }, [
          'reset',
        ]),
        el('button', { class: 'btn accent', onclick: showTokens }, ['export tokens']),
        configInput,
      ]),
      configNote,
    ]),
  );

  // global STEPS card
  const stepsVal = el('span', { class: 'steps-val' }, [String(steps)]);
  const stepsInput = el('input', {
    type: 'range',
    min: 5,
    max: 16,
    step: 1,
    value: steps,
    oninput: (e) => {
      steps = +(e.target as HTMLInputElement).value;
      stepsVal.textContent = String(steps);
      // Deliberately does NOT clamp each family's seedStep. `toSpec` already
      // clamps when it builds the spec, so lowering the step count and raising
      // it again restores the original pins instead of flattening them onto the
      // darkest step permanently.
      remountFamilies();
    },
  });
  app.append(
    el('div', { class: 'globals' }, [
      el('div', { class: 'steps-row' }, [el('span', { class: 'steps-lab' }, ['steps']), stepsVal]),
      stepsInput,
    ]),
  );

  app.append(
    el('div', { class: 'summary' }, [
      el('span', { class: 'legend' }, [
        'contract = darkest steps readable (WCAG AA ≥ 4.5) on the lightest — locks are never overridden to force a pass. Click any swatch strip to open its contrast grid.',
      ]),
    ]),
  );

  app.append(famHost);
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
  if (outEl.firstChild) renderExport();
  scheduleSave();
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
  const notesEl = el('div', { class: 'fam-notes empty' });
  const gridHost = el('div', { class: 'grid-host' });

  const refreshSelf = () => {
    refresh();
    updateSummary();
    if (outEl.firstChild) renderExport();
    scheduleSave();
  };

  const nameInput = el('input', {
    type: 'text',
    value: fam.name,
    'aria-label': 'family name',
    oninput: (e) => {
      fam.name = (e.target as HTMLInputElement).value;
      if (outEl.firstChild) renderExport();
    },
  });

  const curvesBtn = el(
    'button',
    { class: 'btn icon', 'aria-label': 'toggle curves', title: 'curve controls' },
    ['⚙'],
  );
  const removeBtn = el(
    'button',
    {
      class: 'btn icon remove',
      'aria-label': 'remove family',
      title: 'remove family',
      onclick: () => removeFamily(fi),
    },
    ['✕'],
  );

  const head = el('div', { class: 'fam-head' }, [
    nameInput,
    el('span', { class: 'spacer' }),
    badge,
    curvesBtn,
    removeBtn,
  ]);

  // ---- row 2: hue-source controls ----
  const segFromColor = el('button', { onclick: () => setMode('seed') }, ['from color']);
  const segFreeHue = el('button', { onclick: () => setMode('free') }, ['free hue']);
  const seg = el('div', { class: 'seg' }, [segFromColor, segFreeHue]);

  const seedColor = el('input', {
    type: 'color',
    'aria-label': 'base color',
    value: normalizeHex(fam.seed),
    oninput: (e) => {
      fam.seed = (e.target as HTMLInputElement).value;
      refreshSelf();
    },
  }) as HTMLInputElement;
  const seedStepSel = el('select', {
    'aria-label': 'pin step',
    onchange: (e) => {
      fam.seedStep = +(e.target as HTMLSelectElement).value;
      refreshSelf();
    },
  }) as HTMLSelectElement;
  scale.names.forEach((n, i) =>
    seedStepSel.append(
      el('option', { value: i, selected: i === Math.min(fam.seedStep, steps - 1) }, ['pin ' + n]),
    ),
  );
  // The brand's own name for this color, and the token alias that points at it.
  // Two fields rather than one because they are different kinds of string: the
  // name is prose on a swatch, the alias is an identifier someone types.
  const seedName = el('input', {
    type: 'text',
    class: 'color-name',
    value: fam.seedName ?? '',
    placeholder: 'color name',
    title: 'the brand’s name for this color, e.g. "Corporate Blue"',
    'aria-label': 'color name',
    oninput: (e) => {
      const v = (e.target as HTMLInputElement).value.trim();
      if (v === '') delete fam.seedName;
      else fam.seedName = v;
      refreshSelf();
    },
  }) as HTMLInputElement;

  const seedAlias = el('input', {
    type: 'text',
    class: 'color-alias',
    value: fam.seedAlias ?? '',
    placeholder: 'token alias',
    title: 'a second way to point at this color in the token file, e.g. "brand blue"',
    'aria-label': 'token alias',
    oninput: (e) => {
      const v = (e.target as HTMLInputElement).value.trim();
      if (v === '') delete fam.seedAlias;
      else fam.seedAlias = v;
      refreshSelf();
    },
  }) as HTMLInputElement;

  const seedCtrls = el('div', { class: 'seed-only src' }, [
    seedColor,
    seedStepSel,
    seedName,
    seedAlias,
  ]);

  const hue = inlineSlider(
    'hue',
    fam.hue,
    0,
    360,
    1,
    (v) => `${v}°`,
    (v) => {
      fam.hue = v;
      refreshSelf();
    },
  );
  const freeCtrls = el('div', { class: 'free-only' }, [hue.root]);

  const chroma = inlineSlider(
    'chroma',
    fam.chroma,
    0,
    0.3,
    0.005,
    (v) => v.toFixed(3),
    (v) => {
      fam.chroma = v;
      refreshSelf();
    },
  );

  const autoChk = el('input', {
    type: 'checkbox',
    checked: fam.chromaAuto,
    'aria-label': 'auto chroma',
    onchange: (e) => {
      fam.chromaAuto = (e.target as HTMLInputElement).checked;
      sync();
      refreshSelf();
    },
  }) as HTMLInputElement;
  const autoWrap = el(
    'label',
    { class: 'seed-only chk', title: 'derive chroma from the base color' },
    [autoChk, 'auto chroma'],
  );

  const controls = el('div', { class: 'fam-controls' }, [
    seg,
    seedCtrls,
    freeCtrls,
    chroma.root,
    autoWrap,
  ]);

  // ---- curves panel ----
  const lMax = slider(
    'mini',
    'L max',
    fam.lightMax,
    0.9,
    0.995,
    0.005,
    (v) => v.toFixed(3),
    (v) => {
      fam.lightMax = v;
      refreshSelf();
    },
  );
  const lMin = slider(
    'mini',
    'L min',
    fam.lightMin,
    0.08,
    0.35,
    0.005,
    (v) => v.toFixed(3),
    (v) => {
      fam.lightMin = v;
      refreshSelf();
    },
  );
  const gam = slider(
    'mini',
    'gamma',
    fam.gamma,
    0.6,
    1.6,
    0.05,
    (v) => v.toFixed(2),
    (v) => {
      fam.gamma = v;
      refreshSelf();
    },
  );
  const sc = slider(
    'mini',
    'S-curve',
    fam.sCurve,
    0,
    0.5,
    0.01,
    (v) => v.toFixed(2),
    (v) => {
      fam.sCurve = v;
      refreshSelf();
    },
  );
  const tors = slider(
    'mini',
    'hue torsion',
    fam.hueTorsion,
    -60,
    60,
    1,
    (v) => `${v}°`,
    (v) => {
      fam.hueTorsion = v;
      refreshSelf();
    },
  );
  const tPk = slider(
    'mini',
    'chroma peak @',
    fam.tPeak,
    0.2,
    0.9,
    0.05,
    (v) => v.toFixed(2),
    (v) => {
      fam.tPeak = v;
      refreshSelf();
    },
  );
  const cLo = slider(
    'mini',
    'chroma light',
    fam.chromaLight,
    0,
    0.1,
    0.005,
    (v) => v.toFixed(3),
    (v) => {
      fam.chromaLight = v;
      refreshSelf();
    },
  );
  const cHi = slider(
    'mini',
    'chroma dark',
    fam.chromaDark,
    0,
    0.1,
    0.005,
    (v) => v.toFixed(3),
    (v) => {
      fam.chromaDark = v;
      refreshSelf();
    },
  );
  const copyBtn = el('button', { class: 'btn', onclick: () => copyCurvesToAll(fi) }, [
    'copy curves → all',
  ]);

  const curves = el('div', { class: 'curves' }, [
    el('div', { class: 'curve-group' }, [
      el('span', { class: 'glab' }, ['lightness']),
      lMax.root,
      lMin.root,
      gam.root,
      sc.root,
    ]),
    el('div', { class: 'curve-group' }, [
      el('span', { class: 'glab' }, ['chroma shape']),
      tPk.root,
      cLo.root,
      cHi.root,
    ]),
    el('div', { class: 'curve-group' }, [el('span', { class: 'glab' }, ['hue']), tors.root]),
    el('div', { class: 'curve-group' }, [copyBtn]),
  ]);
  curvesBtn.addEventListener('click', () => root.classList.toggle('open-curves'));

  const root = el('div', { class: 'fam' }, [head, controls, curves, strip, notesEl, gridHost]);
  root.dataset.mode = fam.mode;

  function setMode(m: Mode): void {
    fam.mode = m;
    segFromColor.className = m === 'seed' ? 'on' : '';
    segFreeHue.className = m === 'free' ? 'on' : '';
    sync();
    refreshSelf();
  }

  function sync(): void {
    root.dataset.mode = fam.mode;
    segFromColor.className = fam.mode === 'seed' ? 'on' : '';
    segFreeHue.className = fam.mode === 'free' ? 'on' : '';
    const chromaLocked = fam.mode === 'seed' && fam.chromaAuto;
    chroma.input.disabled = chromaLocked;
    for (const s of [tPk.input, cLo.input, cHi.input]) s.disabled = chromaLocked;
    autoChk.checked = fam.chromaAuto;
  }

  function refresh(): void {
    const family = resolveFamily(toSpec(fam));
    const c = checkContract(family);
    const region = contractRegion(family.swatches.length);

    const breaks = new Set(family.monotoneBreaks);
    strip.style.gridTemplateColumns = `repeat(${family.swatches.length}, 1fr)`;
    strip.replaceChildren(
      ...family.swatches.map((s) => {
        const ink = s.oklch.l > 0.6 ? '#15171a' : '#fff';
        // The tooltip carries the request as well as the result, so a clamped
        // swatch says what it was supposed to be.
        const asked = s.clamped
          ? ` · asked C ${s.requested.c.toFixed(3)}, sRGB allows ${s.oklch.c.toFixed(3)}`
          : '';
        // Marker for losses worth acting on; the tooltip covers every clamp.
        const notable = chromaLoss(s) >= MINOR_CHROMA_LOSS;
        return el(
          'div',
          {
            class:
              'sw' +
              (s.locked ? ' locked' : '') +
              (notable ? ' clamped' : '') +
              (breaks.has(s.name) ? ' nonmono' : ''),
            style: `background:${s.hex};color:${ink}`,
            title: `${s.colorName ? s.colorName + ' · ' : ''}${s.alias ? '{' + s.alias + '} · ' : ''}${s.name} · ${s.hex} · L ${s.oklch.l.toFixed(2)} C ${s.oklch.c.toFixed(3)} H ${s.oklch.h.toFixed(0)}${asked}`,
            onclick: () => {
              openGrid = openGrid === fi ? -1 : fi;
              refreshAll();
            },
          },
          [
            el('span', { class: 'n' }, [
              s.name,
              s.locked ? el('span', { class: 'star' }, [' ★']) : null,
              notable ? el('span', { class: 'clamp' }, [' ~']) : null,
            ]),
            s.colorName ? el('span', { class: 'brand' }, [s.colorName]) : null,
            el('span', { class: 'h' }, [s.hex]),
          ],
        );
      }),
    );

    badge.className = 'status ' + (c.passes ? 'ok' : 'bad');
    badge.textContent = `${c.passes ? 'PASS' : 'FAIL ×' + c.failures.length} · worst ${c.worst.fg.name}/${c.worst.bg.name} ${c.worst.contrast.wcag.toFixed(2)}`;

    // Fidelity, reported next to the contract but kept distinct from it: what
    // the engine could not deliver exactly, pass or fail.
    const noteText = summarizeNotes(family);
    notesEl.textContent = noteText ?? '';
    notesEl.className = 'fam-notes' + (noteText ? '' : ' empty');

    gridHost.replaceChildren(openGrid === fi ? gridFor(family, region) : el('span'));
  }

  sync();
  refresh();
  return { el: root, refresh };
}

function gridFor(family: Family, region: { light: number[]; dark: number[] }): HTMLElement {
  const m = contrastMatrix(family);
  const sw = family.swatches;
  const wrap = el('div', { class: 'grid-wrap' });
  wrap.append(
    el('div', { class: 'grid-title' }, ['Contrast grid — rows = text, columns = background']),
    el('div', { class: 'grid-legend' }, [
      el('span', {}, [el('span', { class: 'dot ok' }), 'passes AA (≥4.5)']),
      el('span', {}, [el('span', { class: 'dot bad' }), 'fails AA']),
      el('span', {}, [el('span', { class: 'dot gold' }), 'contract pair (darkest × lightest)']),
    ]),
  );

  const t = el('table', { class: 'grid' });
  t.append(el('tr', {}, [el('th', { class: 'corner' }), ...sw.map((s) => el('th', {}, [s.name]))]));
  sw.forEach((fg, r) => {
    const tr = el('tr', {}, [el('th', {}, [fg.name])]);
    sw.forEach((bg, c) => {
      const v = m[r]![c]!;
      const pass = v.passesAA;
      const isC = region.dark.includes(r) && region.light.includes(c);
      tr.append(
        el(
          'td',
          {
            class: 'cell ' + (isC ? 'contract' : pass ? 'pass' : 'fail'),
            style: `background:${bg.hex};color:${fg.hex}`,
            title: `${fg.name} on ${bg.name} · WCAG ${v.wcag.toFixed(2)} · APCA ${v.apca.toFixed(0)}`,
          },
          [
            el('span', { class: 'aa' }, ['Aa']),
            el('span', { class: 'badge ' + (pass ? 'ok' : 'bad') }, [pass ? '✓' : '✕']),
            el('div', { class: 'ratio' }, [`${v.wcag.toFixed(2)}:1`]),
            el('div', { class: 'lc' }, [`${v.apca >= 0 ? '+' : ''}${v.apca.toFixed(0)} Lc`]),
          ],
        ),
      );
    });
    t.append(tr);
  });
  wrap.append(t);
  return wrap;
}

// ---- structural actions ----
function addFamily(): void {
  families.push(
    mkFamily({
      name: `family ${families.length + 1}`,
      seed: '#3b82f6',
      seedStep: Math.min(6, steps - 1),
    }),
  );
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
    f.lightMax = src.lightMax;
    f.lightMin = src.lightMin;
    f.gamma = src.gamma;
    f.sCurve = src.sCurve;
    f.tPeak = src.tPeak;
    f.chromaLight = src.chromaLight;
    f.chromaDark = src.chromaDark;
    f.hueTorsion = src.hueTorsion;
  }
  remountFamilies();
}

// ---- export panel ----
let lastTokenUrl: string | null = null;
function tokensJson(): string {
  const palette = {
    name: paletteName,
    families: families.map((f) => resolveFamily(toSpec(f))),
  };
  // Any shape declared by an imported config applies here too, so what the
  // panel shows is what the CLI would write. The hex/oklch toggle overrides
  // just the color space.
  try {
    return JSON.stringify(
      toW3CTokens(palette, {
        ...exportShape,
        colorSpace: exportFmt === 'hex' ? 'srgb' : 'oklch',
      }),
      null,
      2,
    );
  } catch (err) {
    // A name collision is the one thing reshaping can refuse to do.
    return `// ${err instanceof Error ? err.message : String(err)}`;
  }
}
function showTokens(): void {
  renderExport();
  outEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderExport(): void {
  const json = tokensJson();

  const segHex = el(
    'button',
    {
      onclick: () => {
        exportFmt = 'hex';
        renderExport();
      },
    },
    ['hex'],
  );
  const segOklch = el(
    'button',
    {
      onclick: () => {
        exportFmt = 'oklch';
        renderExport();
      },
    },
    ['oklch'],
  );
  (exportFmt === 'hex' ? segHex : segOklch).className = 'on';
  const fmtSeg = el('div', { class: 'seg' }, [segHex, segOklch]);

  const copyBtn = el('button', { class: 'btn' }, ['copy']);
  copyBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(json).then(() => {
      copyBtn.textContent = 'copied ✓';
      setTimeout(() => (copyBtn.textContent = 'copy'), 1200);
    });
  });

  if (lastTokenUrl) {
    URL.revokeObjectURL(lastTokenUrl);
    lastTokenUrl = null;
  }
  let downloadBtn: HTMLElement;
  try {
    lastTokenUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    downloadBtn = el('a', { class: 'btn accent', href: lastTokenUrl, download: 'tokens.json' }, [
      'download ↓',
    ]);
  } catch {
    downloadBtn = el('span');
  }

  const pre = el('pre');
  pre.innerHTML = highlight(json);

  outEl.replaceChildren(
    el('div', { class: 'export' }, [
      el('div', { class: 'export-head' }, [
        el('span', { class: 'title' }, ['export — ', el('b', {}, ['tokens.json'])]),
        el('span', { class: 'spacer' }),
        fmtSeg,
        copyBtn,
        downloadBtn,
      ]),
      pre,
    ]),
  );
}

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
function highlight(json: string): string {
  return esc(json).replace(/(&quot;[^&]*?&quot;|"[^"]*?")(\s*:)?/g, (_m, str, colon) =>
    colon ? `<span class="k">${str}</span>${colon}` : `<span class="v">${str}</span>`,
  );
}

/** Coerce any CSS color to a #rrggbb the <input type=color> accepts. */
function normalizeHex(hex: string): string {
  try {
    return toHex(parse(hex));
  } catch {
    return '#888888';
  }
}

mount();
