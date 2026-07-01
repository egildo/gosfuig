/**
 * gosfuig studio — interactive front-end.
 *
 * UI + state only. All color math is delegated to the real library in ../.
 *
 * Rendering model: controls are built ONCE and persist. Slider input mutates
 * state and calls a lightweight refresh() that recomputes derived views
 * (swatches, contract badge, grid) and writes them into existing nodes — the
 * slider you are dragging is never recreated, so dragging is smooth and the
 * live contract check actually tracks the values. Structural changes
 * (add/remove family) do a full remount.
 */
import './studio.css';
import { resolveFamily, type FamilySpec, type Family } from '../family.js';
import { ramp } from '../curves.js';
import { STEP_NAMES, type StepName } from '../naming.js';
import { checkContract, contrastMatrix, DARKEST_4, LIGHTEST_4 } from '../validate.js';
import { toW3CTokens } from '../export/w3c.js';
import { parse, toHex } from '../color/oklch.js';

// ---- studio state (declarative; fed straight into the library) ----
interface GlobalCurve { max: number; min: number; gamma: number; sCurve: number; }
interface FamilyState {
  name: string;
  hue: number;
  chroma: number;
  lock: { index: number; hex: string } | null;
}

const glob: GlobalCurve = { max: 0.98, min: 0.18, gamma: 1.0, sCurve: 0.13 };

const families: FamilyState[] = [
  { name: 'blue', hue: 259, chroma: 0.14, lock: { index: 8, hex: '#1d4ed8' } },
  { name: 'green', hue: 150, chroma: 0.14, lock: null },
  { name: 'amber', hue: 75, chroma: 0.16, lock: null },
  { name: 'red', hue: 27, chroma: 0.14, lock: null },
  { name: 'violet', hue: 300, chroma: 0.14, lock: null },
  { name: 'gray', hue: 260, chroma: 0.01, lock: null },
];

let openGrid = 0; // index of the family whose contrast grid is expanded (-1 = none)

// ---- bridge studio state -> library FamilySpec ----
function toSpec(fam: FamilyState): FamilySpec {
  const locks = fam.lock
    ? ({ [STEP_NAMES[fam.lock.index] as StepName]: fam.lock.hex } as FamilySpec['locks'])
    : undefined;
  return { name: fam.name, hue: fam.hue, chroma: fam.chroma, lightness: ramp(glob), locks };
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
): HTMLElement {
  const out = el('b', {}, [fmt(val)]);
  const inp = el('input', {
    type: 'range', min, max, step, value: val,
    oninput: (e) => { const v = +(e.target as HTMLInputElement).value; out.textContent = fmt(v); on(v); },
  });
  return el('div', { class: cls }, [el('label', {}, [label, out]), inp]);
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

  // global curve controls (built once — these persist across refreshes)
  app.append(
    el('div', { class: 'globals' }, [
      slider('ctrl', 'L max', glob.max, 0.94, 0.995, 0.005, (v) => v.toFixed(3), (v) => { glob.max = v; refreshAll(); }),
      slider('ctrl', 'L min', glob.min, 0.12, 0.3, 0.005, (v) => v.toFixed(3), (v) => { glob.min = v; refreshAll(); }),
      slider('ctrl', 'gamma', glob.gamma, 0.6, 1.6, 0.05, (v) => v.toFixed(2), (v) => { glob.gamma = v; refreshAll(); }),
      slider('ctrl', 'S-curve', glob.sCurve, 0, 0.5, 0.01, (v) => v.toFixed(2), (v) => { glob.sCurve = v; refreshAll(); }),
    ]),
  );

  // live pass summary
  app.append(el('div', { class: 'summary' }, [summaryEl, el('span', { class: 'legend' }, ['contract = 4 darkest readable (WCAG AA ≥ 4.5) on 4 lightest'])]));

  app.append(famHost);

  app.append(
    el('div', { class: 'row' }, [
      el('button', { class: 'btn add', onclick: addFamily }, ['+ add family']),
      el('button', { class: 'btn', onclick: showTokens }, ['export W3C tokens']),
      el('span', { class: 'legend' }, ['click any swatch to toggle its contrast grid']),
    ]),
  );
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
  const strip = el('div', { class: 'strip' });
  const badge = el('span', { class: 'status' });
  const gridHost = el('div', { class: 'grid-host' });

  const nameInput = el('input', { type: 'text', value: fam.name, 'aria-label': 'family name', oninput: (e) => { fam.name = (e.target as HTMLInputElement).value; } });

  // A single-family change can flip its own pass state, so keep the summary live too.
  const refreshSelf = () => { refresh(); updateSummary(); };

  const lockSel = el('select', {
    'aria-label': 'lock step',
    onchange: (e) => {
      const v = (e.target as HTMLSelectElement).value;
      fam.lock = v === '' ? null : { index: +v, hex: fam.lock?.hex ?? '#888888' };
      lockColor.disabled = !fam.lock;
      refreshSelf();
    },
  }) as HTMLSelectElement;
  lockSel.append(el('option', { value: '' }, ['no lock']));
  STEP_NAMES.forEach((n, i) => lockSel.append(el('option', { value: i, selected: !!(fam.lock && fam.lock.index === i) }, ['lock ' + n])));
  const lockColor = el('input', {
    type: 'color', 'aria-label': 'lock color', value: fam.lock ? normalizeHex(fam.lock.hex) : '#888888',
    oninput: (e) => { if (fam.lock) { fam.lock.hex = (e.target as HTMLInputElement).value; refreshSelf(); } },
  }) as HTMLInputElement;
  lockColor.disabled = !fam.lock;

  const top = el('div', { class: 'fam-top' }, [
    nameInput,
    slider('mini', 'hue', fam.hue, 0, 360, 1, (v) => `${v}°`, (v) => { fam.hue = v; refreshSelf(); }),
    slider('mini', 'chroma', fam.chroma, 0, 0.2, 0.005, (v) => v.toFixed(3), (v) => { fam.chroma = v; refreshSelf(); }),
    badge,
    el('div', { class: 'lockrow' }, [lockSel, lockColor]),
    el('button', { class: 'btn icon remove', 'aria-label': 'remove family', title: 'remove family', onclick: () => removeFamily(fi) }, ['✕']),
  ]);

  const root = el('div', { class: 'fam' }, [top, strip, gridHost]);

  function refresh(): void {
    const family = resolveFamily(toSpec(fam));
    const c = checkContract(family);

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

    gridHost.replaceChildren(openGrid === fi ? gridFor(family) : el('span'));
  }

  refresh();
  return { el: root, refresh };
}

function gridFor(family: Family): HTMLElement {
  const m = contrastMatrix(family);
  const sw = family.swatches;
  const t = el('table', { class: 'grid' });
  t.append(el('tr', {}, [el('th', {}, ['fg\\bg']), ...sw.map((s) => el('th', {}, [s.name]))]));
  sw.forEach((fg, r) => {
    const tr = el('tr', {}, [el('th', {}, [fg.name])]);
    sw.forEach((bg, c) => {
      const v = m[r]![c]!;
      const isC = DARKEST_4.includes(r) && LIGHTEST_4.includes(c);
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
  families.push({ name: `family ${families.length + 1}`, hue: 200, chroma: 0.13, lock: null });
  openGrid = -1;
  remountFamilies();
}
function removeFamily(fi: number): void {
  families.splice(fi, 1);
  if (openGrid === fi) openGrid = -1;
  else if (openGrid > fi) openGrid -= 1;
  remountFamilies();
}

function showTokens(): void {
  const palette = { name: 'gosfuig studio', families: families.map((f) => resolveFamily(toSpec(f))) };
  const json = JSON.stringify(toW3CTokens(palette), null, 2);
  outEl.innerHTML = '';
  try {
    const blob = new Blob([json], { type: 'application/json' });
    outEl.append(el('a', { class: 'btn', href: URL.createObjectURL(blob), download: 'tokens.json', style: 'display:inline-block;margin-bottom:8px' }, ['⬇ download tokens.json']));
  } catch { /* download unavailable in sandbox */ }
  outEl.append(el('pre', {}, [json]));
}

/** Coerce any CSS color to a #rrggbb the <input type=color> accepts. */
function normalizeHex(hex: string): string {
  try { return toHex(parse(hex)); } catch { return '#888888'; }
}

mount();
