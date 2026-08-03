/**
 * The round trip: one file format, three producers and three consumers.
 *
 * The load-bearing claim of Phase 2 is that a palette authored in the studio
 * can be written to disk, read by the CLI, and produce byte-identical tokens —
 * and that reading it back into the studio restores the session exactly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stringifyConfig,
  parseConfig,
  normalizeConfig,
  readExtension,
  withExtension,
  CONFIG_VERSION,
} from '../src/config.js';
import { resolvePalette } from '../src/palette.js';
import { toW3CTokens } from '../src/export/w3c.js';
import { seedFamily } from '../src/family.js';
import { runCli, type CliIO } from '../src/cli.js';
import {
  toConfig,
  fromConfig,
  mkFamily,
  defaultFamilies,
  toSpec,
  STUDIO_OWNER,
  type StudioSession,
} from '../src/studio/model.js';

const captureIO = (): CliIO & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m) => out.push(m), error: (m) => err.push(m) };
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gosfuig-config-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the config file', () => {
  it('stamps the version and keeps a stable key order', () => {
    const text = stringifyConfig({ families: [{ name: 'blue', hue: 259, steps: 12 }] });
    expect(JSON.parse(text).$version).toBe(CONFIG_VERSION);
    expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(JSON.parse(text).families[0])).toEqual(['name', 'hue', 'steps']);
  });

  it('drops undefined fields rather than emitting nulls', () => {
    const text = stringifyConfig({ name: undefined, families: [{ name: 'b', hue: 1 }] });
    expect(text).not.toContain('null');
    expect(JSON.parse(text)).not.toHaveProperty('name');
  });

  it('normalizing does not change what the spec resolves to', () => {
    const spec = {
      families: [
        seedFamily({ name: 'brand', seed: '#1d4ed8', step: '700', hueTorsion: 20 }),
        { name: 'gray', hue: 260, chroma: 0.01 },
      ],
    };
    expect(JSON.stringify(resolvePalette(normalizeConfig(spec)))).toBe(
      JSON.stringify(resolvePalette(spec)),
    );
  });

  it('rejects a version newer than this build', () => {
    expect(() => parseConfig(JSON.stringify({ $version: 99, families: [] }))).toThrow(
      /newer than this build/,
    );
  });

  it('names the source when the JSON is malformed', () => {
    expect(() => parseConfig('{ nope', 'my-palette.json')).toThrow(/my-palette\.json/);
  });

  it('carries vendor data under $extensions without the engine caring', () => {
    const spec = withExtension({ families: [{ name: 'b', hue: 1 }] }, 'someone.else', { a: 1 });
    const back = parseConfig(stringifyConfig(spec));
    expect(readExtension(back, 'someone.else')).toEqual({ a: 1 });
    expect(readExtension(back, 'nobody')).toBeUndefined();
    expect(resolvePalette(back).families).toHaveLength(1);
  });
});

describe('studio session round trip', () => {
  const session = (): StudioSession => ({ steps: 12, families: defaultFamilies() });

  it('restores a session exactly through the config file', () => {
    const before = session();
    const after = fromConfig(parseConfig(stringifyConfig(toConfig(before))));
    expect(after).toEqual(before);
  });

  it('survives non-default step counts and every family mode', () => {
    const before: StudioSession = {
      steps: 9,
      families: [
        mkFamily({ name: 'seeded', mode: 'seed', seed: '#1d4ed8', seedStep: 5, chromaAuto: true }),
        mkFamily({ name: 'free', mode: 'free', hue: 140, hueTorsion: -18, chromaAuto: false }),
        mkFamily({ name: 'tuned', mode: 'free', hue: 30, sCurve: 0.31, gamma: 1.25, tPeak: 0.42 }),
      ],
    };
    const after = fromConfig(parseConfig(stringifyConfig(toConfig(before))));
    expect(after).toEqual(before);
  });

  it('reconstructs a usable session from a foreign config with no studio extension', () => {
    const foreign = parseConfig(
      stringifyConfig({
        families: [
          { name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } },
          {
            name: 'custom',
            hue: { kind: 'hueRamp', start: 130, end: 170 },
            chroma: { kind: 'bump', peak: 0.11, tPeak: 0.5 },
            lightness: { kind: 'ramp', max: 0.97, min: 0.2, sCurve: 0.2 },
          },
        ],
      }),
    );
    const s = fromConfig(foreign);

    // A lone lock reads as a seed pinned at that step.
    expect(s.families[0]).toMatchObject({ mode: 'seed', seed: '#1d4ed8', seedStep: 8 });
    // A hue ramp reads as a centered hue plus its torsion.
    expect(s.families[1]).toMatchObject({
      mode: 'free',
      hue: 150,
      hueTorsion: 40,
      chroma: 0.11,
      tPeak: 0.5,
      lightMax: 0.97,
      lightMin: 0.2,
      sCurve: 0.2,
      chromaAuto: false,
    });
  });

  it('ignores a corrupt studio extension and falls back to reconstruction', () => {
    const spec = withExtension({ families: [{ name: 'b', hue: 259 }] }, STUDIO_OWNER, 'garbage');
    const s = fromConfig(spec);
    expect(s.families).toHaveLength(1);
    expect(s.families[0]!.name).toBe('b');
  });
});

describe('studio -> CLI -> tokens', () => {
  it('produces byte-identical tokens from the studio and from the CLI', async () => {
    const s = session12();
    const spec = toConfig(s, 'handoff');

    // What the studio's own export panel would emit.
    const studioTokens = JSON.stringify(
      toW3CTokens(resolvePalette(spec), { colorSpace: 'srgb' }),
      null,
      2,
    );

    // The same session, written to disk and run through the CLI.
    const cfg = join(dir, 'palette.config.json');
    writeFileSync(cfg, stringifyConfig(spec));
    const out = join(dir, 'out');
    expect(await runCli([cfg, '-o', out, '--srgb'], captureIO())).toBe(0);

    expect(readFileSync(join(out, 'tokens.json'), 'utf8')).toBe(studioTokens);
  });

  it('--emit-config writes a config that reloads to the same tokens', async () => {
    const cfg = join(dir, 'in.config.json');
    writeFileSync(cfg, stringifyConfig(toConfig(session12(), 'handoff')));

    const a = join(dir, 'a');
    await runCli([cfg, '-o', a, '--emit-config', '--no-dashboard'], captureIO());
    const emitted = join(a, 'palette.config.json');
    expect(existsSync(emitted)).toBe(true);

    const b = join(dir, 'b');
    await runCli([emitted, '-o', b, '--emit-config', '--no-dashboard'], captureIO());

    expect(readFileSync(join(b, 'tokens.json'), 'utf8')).toBe(
      readFileSync(join(a, 'tokens.json'), 'utf8'),
    );
    // And the emitted config is itself a fixed point.
    expect(readFileSync(join(b, 'palette.config.json'), 'utf8')).toBe(
      readFileSync(emitted, 'utf8'),
    );
  });

  it('--emit-config freezes a module config into JSON, studio extension and all', async () => {
    const mjs = join(dir, 'palette.mjs');
    writeFileSync(mjs, `export default ${JSON.stringify(toConfig(session12(), 'from module'))};\n`);
    const out = join(dir, 'out');
    await runCli([mjs, '-o', out, '--emit-config', '--no-dashboard'], captureIO());

    const frozen = parseConfig(readFileSync(join(out, 'palette.config.json'), 'utf8'));
    expect(frozen.name).toBe('from module');
    expect(fromConfig(frozen)).toEqual(session12());
  });

  function session12(): StudioSession {
    return {
      steps: 12,
      families: [
        mkFamily({ name: 'signal blue', seed: '#1d4ed8', seedStep: 8 }),
        mkFamily({ name: 'sage', mode: 'free', hue: 150, hueTorsion: 12, chromaAuto: false }),
      ],
    };
  }
});

describe('--emit-config is off unless asked', () => {
  it('writes no config by default', async () => {
    const cfg = join(dir, 'p.json');
    writeFileSync(cfg, stringifyConfig({ families: [{ name: 'g', hue: 150 }] }));
    const out = join(dir, 'out');
    await runCli([cfg, '-o', out], captureIO());
    expect(existsSync(join(out, 'palette.config.json'))).toBe(false);
  });
});

describe('the studio spec bridge', () => {
  it('emits pure data — nothing in a spec is a function', () => {
    const walk = (v: unknown): void => {
      expect(typeof v).not.toBe('function');
      if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const f of defaultFamilies()) walk(toSpec(f, 12));
  });
});
