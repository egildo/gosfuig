/**
 * Templates: the reusable half of a palette, saved under a name.
 *
 * The point of the split is that a new brand should not start from nothing.
 * A branding book supplies colours; a template supplies the house style; the
 * two resolve into an ordinary config that stands on its own afterwards.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_TEMPLATES,
  findTemplate,
  templateNames,
  applyTemplate,
  forceTemplate,
  isTemplate,
  templateFromSpec,
  type Template,
} from '../src/template.js';
import { resolvePalette } from '../src/palette.js';
import { checkContract } from '../src/validate.js';
import { stringifyConfig, parseConfig } from '../src/config.js';
import { runCli, loadTemplate, parseArgs, type CliIO } from '../src/cli.js';

const captureIO = (): CliIO & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m) => out.push(m), error: (m) => err.push(m) };
};

const BRAND = {
  families: [{ name: 'blue', hue: 259, colors: [{ name: 'Acme Blue', value: '#3b82f6' }] }],
};

describe('the built-ins', () => {
  it('are all valid templates with distinct names', () => {
    for (const t of BUILTIN_TEMPLATES) expect(isTemplate(t)).toBe(true);
    expect(new Set(templateNames()).size).toBe(BUILTIN_TEMPLATES.length);
  });

  it('all carry a description, since the name alone does not explain a house style', () => {
    for (const t of BUILTIN_TEMPLATES) expect(t.description).toBeTruthy();
  });

  it('produce genuinely different ramps', () => {
    const hexes = BUILTIN_TEMPLATES.map((t) =>
      resolvePalette(applyTemplate(BRAND, t))
        .families[0]!.swatches.map((s) => s.hex)
        .join(),
    );
    expect(new Set(hexes).size).toBe(BUILTIN_TEMPLATES.length);
  });

  it('"contrast" earns its name against "default"', () => {
    const worst = (name: string) =>
      checkContract(resolvePalette(applyTemplate(BRAND, findTemplate(name)!)).families[0]!).worst
        .contrast.wcag;
    expect(worst('contrast')).toBeGreaterThan(worst('default'));
  });

  it('"fine" really is a longer scale', () => {
    const fam = resolvePalette(applyTemplate(BRAND, findTemplate('fine')!)).families[0]!;
    expect(fam.swatches).toHaveLength(16);
  });
});

describe('applyTemplate — the template is a base, the config wins', () => {
  const t: Template = {
    name: 't',
    steps: 8,
    lightness: { kind: 'ramp', max: 0.9, min: 0.2 },
    export: { prefix: 'house' },
  };

  it('fills in what the config left unsaid', () => {
    const out = applyTemplate(BRAND, t);
    expect(out.families[0]!.steps).toBe(8);
    expect(out.families[0]!.lightness).toEqual(t.lightness);
    expect(out.export).toEqual({ prefix: 'house' });
  });

  it('leaves anything the config stated alone', () => {
    const spec = {
      families: [
        {
          name: 'blue',
          hue: 259,
          steps: 12,
          lightness: { kind: 'ramp' as const, max: 0.99, min: 0.1 },
        },
      ],
      export: { prefix: 'mine' },
    };
    const out = applyTemplate(spec, t);
    expect(out.families[0]!.steps).toBe(12);
    expect(out.families[0]!.lightness).toEqual(spec.families[0]!.lightness);
    expect(out.export).toEqual({ prefix: 'mine' });
  });

  it('never touches the brand colours', () => {
    expect(applyTemplate(BRAND, t).families[0]!.colors).toEqual(BRAND.families[0]!.colors);
  });

  it('does not mutate its inputs', () => {
    const spec = structuredClone(BRAND);
    applyTemplate(spec, t);
    expect(spec).toEqual(BRAND);
  });

  it('leaves chroma alone unless the template asks, so a seed keeps its own', () => {
    expect(applyTemplate(BRAND, t).families[0]!.chroma).toBeUndefined();
    expect(applyTemplate(BRAND, { ...t, chroma: 0.09 }).families[0]!.chroma).toBe(0.09);
  });

  it('resolves away — the result is an ordinary spec with no memory of the template', () => {
    const merged = applyTemplate(BRAND, t);
    expect(merged).not.toHaveProperty('template');
    const reparsed = parseConfig(stringifyConfig(merged));
    expect(JSON.stringify(resolvePalette(reparsed))).toBe(JSON.stringify(resolvePalette(merged)));
  });
});

describe('forceTemplate — for a palette that already has curves', () => {
  it('overwrites what applyTemplate would have skipped', () => {
    const spec = {
      families: [
        {
          name: 'b',
          hue: 259,
          steps: 12,
          lightness: { kind: 'ramp' as const, max: 0.99, min: 0.1 },
        },
      ],
    };
    const t = findTemplate('flat')!;
    expect(applyTemplate(spec, t).families[0]!.lightness).toEqual(spec.families[0]!.lightness);
    expect(forceTemplate(spec, t).families[0]!.lightness).toEqual(t.lightness);
  });

  it('still never touches the brand colours', () => {
    const out = forceTemplate(BRAND, findTemplate('flat')!);
    expect(out.families[0]!.colors).toEqual(BRAND.families[0]!.colors);
  });
});

describe('isTemplate', () => {
  it('needs a name and rejects stray fields', () => {
    expect(isTemplate({ name: 'x' })).toBe(true);
    expect(isTemplate({ name: 'x', steps: 8, description: 'd' })).toBe(true);
    expect(isTemplate({})).toBe(false);
    expect(isTemplate({ name: '  ' })).toBe(false);
    expect(isTemplate({ name: 'x', families: [] })).toBe(false);
    expect(isTemplate(null)).toBe(false);
    expect(isTemplate('flat')).toBe(false);
  });
});

describe('the CLI', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gosfuig-tpl-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const brandFile = () => {
    const p = join(dir, 'brand.json');
    writeFileSync(p, stringifyConfig(BRAND));
    return p;
  };

  it('parses --template and --templates', () => {
    expect(parseArgs(['p.json', '--template', 'flat']).template).toBe('flat');
    expect(parseArgs(['--templates']).listTemplates).toBe(true);
    expect(parseArgs(['p.json', '--template']).errors).toHaveLength(1);
  });

  it('lists the built-ins and exits 0', async () => {
    const io = captureIO();
    expect(await runCli(['--templates'], io)).toBe(0);
    for (const t of BUILTIN_TEMPLATES) expect(io.out.join('\n')).toContain(t.name);
  });

  it('resolves a built-in by name', () => {
    expect(loadTemplate('flat')).toEqual(findTemplate('flat'));
  });

  it('names the built-ins when given an unknown one', () => {
    expect(() => loadTemplate('sausage')).toThrow(/unknown template "sausage"/);
    expect(() => loadTemplate('sausage')).toThrow(/contrast/);
  });

  it('loads a template from a .json file', () => {
    const p = join(dir, 'house.json');
    writeFileSync(p, JSON.stringify({ name: 'house', steps: 6 }));
    expect(loadTemplate(p)).toEqual({ name: 'house', steps: 6 });
  });

  it('refuses a .json file that is not a template', () => {
    const p = join(dir, 'nope.json');
    writeFileSync(p, JSON.stringify({ families: [] }));
    expect(() => loadTemplate(p)).toThrow(/is not a template/);
  });

  it('applies a template and exits 0', async () => {
    const io = captureIO();
    const out = join(dir, 'o');
    expect(await runCli([brandFile(), '-o', out, '--template', 'fine', '--no-dashboard'], io)).toBe(
      0,
    );
    const tokens = JSON.parse(readFileSync(join(out, 'tokens.json'), 'utf8'));
    expect(Object.keys(tokens.blue).filter((k) => !k.startsWith('$'))).toHaveLength(16);
  });

  it('exits 1 with a message for an unknown template', async () => {
    const io = captureIO();
    expect(await runCli([brandFile(), '-o', join(dir, 'o'), '--template', 'sausage'], io)).toBe(1);
    expect(io.err.join('\n')).toContain('unknown template');
  });

  it('--emit-config freezes the template in, so the config then stands alone', async () => {
    const a = join(dir, 'a');
    await runCli(
      [brandFile(), '-o', a, '--template', 'contrast', '--emit-config', '--no-dashboard'],
      captureIO(),
    );

    // Re-running the emitted config WITHOUT --template must give the same thing.
    const b = join(dir, 'b');
    await runCli([join(a, 'palette.config.json'), '-o', b, '--no-dashboard'], captureIO());
    expect(readFileSync(join(b, 'tokens.json'), 'utf8')).toBe(
      readFileSync(join(a, 'tokens.json'), 'utf8'),
    );
  });
});

describe('templates and named colours interact through the step scale', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gosfuig-tpl2-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Step NAMES are scale-dependent: "500" is on the 12-step scale and not on
   * the 16-step one. So a template that changes `steps` can invalidate a colour
   * that named its step — which must read as a located spec error, never as a
   * raw throw from inside the engine.
   */
  const STEPPED = {
    families: [{ name: 'blue', hue: 259, colors: [{ value: '#3b82f6', step: '500' }] }],
  };

  it('reports the mismatch against the scale the template chose', async () => {
    const p = join(dir, 'p.json');
    writeFileSync(p, stringifyConfig(STEPPED));
    const io = captureIO();
    expect(await runCli([p, '-o', join(dir, 'o'), '--template', 'fine'], io)).toBe(1);
    const err = io.err.join('\n');
    expect(err).toContain('families[0].colors[0].step');
    expect(err).toContain('16-step scale');
    expect(err).not.toContain('out of range');
  });

  it('is fine when the template keeps the scale', async () => {
    const p = join(dir, 'p.json');
    writeFileSync(p, stringifyConfig(STEPPED));
    expect(
      await runCli(
        [p, '-o', join(dir, 'o'), '--template', 'contrast', '--no-dashboard'],
        captureIO(),
      ),
    ).toBe(0);
  });

  it('is fine at any step count when the colour leaves placement to the engine', async () => {
    const p = join(dir, 'p.json');
    writeFileSync(
      p,
      stringifyConfig({
        families: [{ name: 'blue', hue: 259, colors: [{ value: '#3b82f6' }] }],
      }),
    );
    for (const t of ['default', 'contrast', 'flat', 'fine']) {
      expect(
        await runCli([p, '-o', join(dir, t), '--template', t, '--no-dashboard'], captureIO()),
      ).toBe(0);
    }
  });
});

describe('templateFromSpec — reading a house style back out', () => {
  it('takes the reusable half and nothing else', () => {
    const t = templateFromSpec(
      {
        name: 'acme',
        families: [
          {
            name: 'blue',
            hue: 259,
            steps: 12,
            lightness: { kind: 'ramp', max: 0.98, min: 0.18, sCurve: 0.2 },
            colors: [{ name: 'Acme Blue', alias: 'brand blue', value: '#3b82f6' }],
          },
        ],
        export: { prefix: 'color' },
      },
      'house',
      'our style',
    );

    expect(t).toEqual({
      name: 'house',
      description: 'our style',
      steps: 12,
      lightness: { kind: 'ramp', max: 0.98, min: 0.18, sCurve: 0.2 },
      export: { prefix: 'color' },
    });
    // Brand facts must never end up in a template.
    expect(JSON.stringify(t)).not.toContain('3b82f6');
    expect(JSON.stringify(t)).not.toContain('Acme');
    expect(JSON.stringify(t)).not.toContain('259');
  });

  it('produces something isTemplate accepts and applyTemplate can use', () => {
    const source = {
      families: [
        { name: 'a', hue: 1, steps: 8, lightness: { kind: 'ramp' as const, max: 0.9, min: 0.2 } },
      ],
    };
    const t = templateFromSpec(source, 'house');
    expect(isTemplate(t)).toBe(true);

    const applied = applyTemplate(BRAND, t);
    expect(applied.families[0]!.steps).toBe(8);
    expect(applied.families[0]!.lightness).toEqual(source.families[0]!.lightness);
  });

  it('round-trips a house style: extract, apply, extract again', () => {
    const tuned = applyTemplate(BRAND, findTemplate('contrast')!);
    const extracted = templateFromSpec(tuned, 'house');
    const reapplied = applyTemplate(BRAND, extracted);
    expect(templateFromSpec(reapplied, 'house')).toEqual(extracted);
  });

  it('copes with a palette that states no policy at all', () => {
    expect(templateFromSpec({ families: [{ name: 'a', hue: 1 }] }, 'bare')).toEqual({
      name: 'bare',
    });
  });
});

describe('--emit-template', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gosfuig-et-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a template the CLI can read straight back', async () => {
    const cfg = join(dir, 'brand.json');
    writeFileSync(cfg, stringifyConfig(BRAND));
    const out = join(dir, 'o');

    await runCli(
      [cfg, '-o', out, '--template', 'contrast', '--emit-template', 'house', '--no-dashboard'],
      captureIO(),
    );

    const file = join(out, 'house.template.json');
    const saved = loadTemplate(file);
    expect(saved.name).toBe('house');
    expect(saved.lightness).toEqual(findTemplate('contrast')!.lightness);

    // Applying the saved file gives the same tokens as the built-in did.
    const b = join(dir, 'b');
    await runCli([cfg, '-o', b, '--template', file, '--no-dashboard'], captureIO());
    expect(readFileSync(join(b, 'tokens.json'), 'utf8')).toBe(
      readFileSync(join(out, 'tokens.json'), 'utf8'),
    );
  });

  it('never writes brand colours into the template', async () => {
    const cfg = join(dir, 'brand.json');
    writeFileSync(cfg, stringifyConfig(BRAND));
    const out = join(dir, 'o');
    await runCli([cfg, '-o', out, '--emit-template', 'house', '--no-dashboard'], captureIO());
    const text = readFileSync(join(out, 'house.template.json'), 'utf8');
    expect(text).not.toContain('3b82f6');
    expect(text).not.toContain('Acme');
  });

  it('errors when the name is missing', () => {
    expect(parseArgs(['p.json', '--emit-template']).errors).toHaveLength(1);
  });

  it('is off unless asked', async () => {
    const cfg = join(dir, 'brand.json');
    writeFileSync(cfg, stringifyConfig(BRAND));
    const out = join(dir, 'o');
    await runCli([cfg, '-o', out, '--no-dashboard'], captureIO());
    expect(existsSync(join(out, 'house.template.json'))).toBe(false);
  });
});
