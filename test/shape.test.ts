import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, shapeEntries, resolveShape } from '../src/export/shape.js';
import { toW3CTokens } from '../src/export/w3c.js';
import { resolvePalette } from '../src/palette.js';
import { stringifyConfig, parseConfig } from '../src/config.js';
import { validatePaletteSpec } from '../src/spec.js';
import { runCli, type CliIO } from '../src/cli.js';

const captureIO = (): CliIO & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m) => out.push(m), error: (m) => err.push(m) };
};

const palette = (...names: string[]) =>
  resolvePalette({ families: names.map((name) => ({ name, hue: 259, steps: 2 })) });

describe('slugify', () => {
  it('kebab-cases by default — the fix for family names with spaces', () => {
    expect(slugify('signal blue')).toBe('signal-blue');
    expect(slugify('ember amber')).toBe('ember-amber');
    expect(slugify('Brand Primary')).toBe('brand-primary');
    expect(slugify('signalBlue')).toBe('signal-blue');
    expect(slugify('signal_blue')).toBe('signal-blue');
    expect(slugify('signal   blue')).toBe('signal-blue');
  });

  it('supports camel and snake', () => {
    expect(slugify('signal blue', 'camel')).toBe('signalBlue');
    expect(slugify('Signal Blue', 'camel')).toBe('signalBlue');
    expect(slugify('signal blue', 'snake')).toBe('signal_blue');
  });

  it('leaves names alone under "none" — except DTCG reserved characters', () => {
    expect(slugify('Signal Blue', 'none')).toBe('Signal Blue');
    // `.`, `{` and `}` would break `{group.token}` reference resolution.
    expect(slugify('a.b', 'none')).toBe('a-b');
    expect(slugify('a{b}c', 'none')).toBe('a-b-c');
    expect(slugify('a.b')).toBe('a-b');
  });

  it('honors a custom separator', () => {
    expect(slugify('signal blue', 'kebab', '.')).toBe('signal.blue');
  });

  it('never returns an empty segment', () => {
    expect(slugify('   ')).toBe('-');
    expect(slugify('...')).not.toBe('');
  });
});

describe('resolveShape', () => {
  it('defaults to kebab, nested, "-" separator, no prefix', () => {
    expect(resolveShape()).toEqual({
      prefix: [],
      groups: {},
      steps: {},
      slug: 'kebab',
      flatten: false,
      separator: '-',
    });
  });

  it('accepts a prefix as a string or an array, and slugs it', () => {
    expect(resolveShape({ prefix: 'Design Color' }).prefix).toEqual(['design-color']);
    expect(resolveShape({ prefix: ['brand', 'color'] }).prefix).toEqual(['brand', 'color']);
  });
});

describe('shapeEntries', () => {
  const inputs = [
    { group: 'signal blue', step: '500', value: 1 },
    { group: 'signal blue', step: '700', value: 2 },
  ];

  it('renames groups and steps before slugging', () => {
    const out = shapeEntries(inputs, {
      groups: { 'signal blue': 'Brand' },
      steps: { '500': 'base' },
    });
    expect(out.map((e) => e.path)).toEqual([
      ['brand', 'base'],
      ['brand', '700'],
    ]);
  });

  it('applies the prefix to every path', () => {
    const out = shapeEntries(inputs, { prefix: ['color', 'core'] });
    expect(out[0]!.path).toEqual(['color', 'core', 'signal-blue', '500']);
  });

  it('refuses to silently drop a token on a name collision', () => {
    expect(() =>
      shapeEntries([
        { group: 'signal blue', step: '500', value: 1 },
        { group: 'Signal-Blue', step: '500', value: 2 },
      ]),
    ).toThrow(/collision/);
  });

  it('does not report a collision for a family repeating its own steps', () => {
    expect(() => shapeEntries(inputs)).not.toThrow();
  });
});

describe('toW3CTokens shaping', () => {
  it('kebab-cases family names by default — the studio bug, fixed', () => {
    const out = toW3CTokens(palette('signal blue'));
    expect(Object.keys(out)).toEqual(['signal-blue']);
    expect((out['signal-blue'] as any).$type).toBe('color');
  });

  it('nests under a prefix, keeping $type on the group that holds tokens', () => {
    const out = toW3CTokens(palette('blue'), { prefix: 'color' }) as any;
    expect(Object.keys(out)).toEqual(['color']);
    expect(out.color.blue.$type).toBe('color');
    expect(out.color.blue['50'].$value).toBeDefined();
    expect(out.color.$type).toBeUndefined();
  });

  it('flattens to one level, with $type at the root', () => {
    const out = toW3CTokens(palette('signal blue'), { flatten: true, prefix: 'color' }) as any;
    expect(out.$type).toBe('color');
    expect(Object.keys(out).filter((k) => !k.startsWith('$'))).toEqual([
      'color-signal-blue-50',
      'color-signal-blue-950',
    ]);
  });

  it('honors a custom separator when flattening', () => {
    const out = toW3CTokens(palette('blue'), { flatten: true, separator: '.' }) as any;
    expect(Object.keys(out)).toContain('blue.50');
  });

  it('renames groups and steps', () => {
    const out = toW3CTokens(palette('signal blue'), {
      groups: { 'signal blue': 'brand' },
      steps: { '50': 'lightest', '950': 'darkest' },
    }) as any;
    expect(Object.keys(out.brand).filter((k: string) => !k.startsWith('$'))).toEqual([
      'lightest',
      'darkest',
    ]);
  });

  it('changes names only — the colors are untouched', () => {
    const p = palette('signal blue');
    const plain = toW3CTokens(p, { colorSpace: 'srgb' }) as any;
    const shaped = toW3CTokens(p, {
      colorSpace: 'srgb',
      prefix: 'color',
      slug: 'camel',
      groups: { 'signal blue': 'brand' },
    }) as any;
    expect(shaped.color.brand['50'].$value).toBe(plain['signal-blue']['50'].$value);
    expect(shaped.color.brand['950'].$value).toBe(plain['signal-blue']['950'].$value);
  });
});

describe('the export block in a config', () => {
  it('validates its fields and rejects typos', () => {
    expect(
      validatePaletteSpec({ families: [], export: { slug: 'kebab', prefix: 'color' } }).ok,
    ).toBe(true);

    const r = validatePaletteSpec({
      families: [],
      export: { slug: 'sausage', prefix: 3, flatten: 'yes', groups: { a: 1 }, prefx: 'x' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.path);
      expect(paths).toContain('export.slug');
      expect(paths).toContain('export.prefix');
      expect(paths).toContain('export.flatten');
      expect(paths).toContain('export.groups.a');
      expect(paths).toContain('export.prefx');
    }
  });

  it('survives the config round trip', () => {
    const spec = {
      families: [{ name: 'signal blue', hue: 259 }],
      export: { prefix: 'color', slug: 'camel' as const, groups: { 'signal blue': 'brand' } },
    };
    expect(parseConfig(stringifyConfig(spec)).export).toEqual(spec.export);
  });
});

describe('the CLI applies the config export block', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gosfuig-shape-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (spec: unknown) => {
    const p = join(dir, 'p.json');
    writeFileSync(p, stringifyConfig(spec as never));
    return p;
  };
  const tokens = (out: string) => JSON.parse(readFileSync(join(out, 'tokens.json'), 'utf8'));

  it('reshapes the emitted file from the config alone', async () => {
    const cfg = write({
      families: [{ name: 'signal blue', hue: 259, steps: 2 }],
      export: { prefix: 'color', groups: { 'signal blue': 'brand' }, colorSpace: 'srgb' },
    });
    const out = join(dir, 'out');
    expect(await runCli([cfg, '-o', out, '--no-dashboard'], captureIO())).toBe(0);
    expect(typeof tokens(out).color.brand['50'].$value).toBe('string');
  });

  it('lets --srgb override the config, since a flag is more specific', async () => {
    const cfg = write({
      families: [{ name: 'blue', hue: 259, steps: 2 }],
      export: { colorSpace: 'oklch' },
    });
    const a = join(dir, 'a');
    await runCli([cfg, '-o', a, '--no-dashboard'], captureIO());
    expect(tokens(a).blue['50'].$value.colorSpace).toBe('oklch');

    const b = join(dir, 'b');
    await runCli([cfg, '-o', b, '--no-dashboard', '--srgb'], captureIO());
    expect(typeof tokens(b).blue['50'].$value).toBe('string');
  });

  it('exits 1 with the collision message rather than dropping a token', async () => {
    const cfg = write({
      families: [
        { name: 'signal blue', hue: 259, steps: 2 },
        { name: 'Signal-Blue', hue: 100, steps: 2 },
      ],
    });
    const io = captureIO();
    expect(await runCli([cfg, '-o', join(dir, 'out'), '--no-dashboard'], io)).toBe(1);
    expect(io.err.join('\n')).toMatch(/collision/);
  });
});
