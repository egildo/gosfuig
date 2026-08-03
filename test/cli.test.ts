import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli, helpText, type CliIO } from '../src/cli.js';

/** Collects CLI output so assertions can read it back. */
function captureIO(): CliIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (m) => out.push(m), error: (m) => err.push(m) };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gosfuig-cli-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a palette spec into the temp dir and return its path. */
function fixture(name: string, spec: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(spec));
  return p;
}

const PASSING = { name: 'p', families: [{ name: 'green', hue: 150 }] };
// #1d4ed8 at step 700 is the known contract failure (worst pair 700/200 ≈ 3.80).
const FAILING = {
  name: 'f',
  families: [{ name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } }],
};

describe('parseArgs', () => {
  it('defaults to out/, oklch tokens, dashboard on, non-strict', () => {
    const o = parseArgs([]);
    expect(o).toMatchObject({ out: 'out', srgb: false, dashboard: true, strict: false });
    expect(o.config).toBeUndefined();
    expect(o.errors).toEqual([]);
  });

  it('reads the positional config and every flag', () => {
    const o = parseArgs(['palette.json', '-o', 'tokens', '--srgb', '--no-dashboard', '--strict']);
    expect(o).toMatchObject({
      config: 'palette.json',
      out: 'tokens',
      srgb: true,
      dashboard: false,
      strict: true,
    });
    expect(o.errors).toEqual([]);
  });

  it('accepts --out as well as -o', () => {
    expect(parseArgs(['--out', 'dist-tokens']).out).toBe('dist-tokens');
  });

  it('records an error for an unknown option instead of exiting', () => {
    const o = parseArgs(['--nope']);
    expect(o.errors).toHaveLength(1);
    expect(o.errors[0]).toContain('--nope');
  });

  it('records an error when --out has no value', () => {
    const o = parseArgs(['palette.json', '-o']);
    expect(o.errors).toHaveLength(1);
    expect(o.errors[0]).toContain('-o');
  });

  it('flags help for -h and --help', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('runCli exit codes', () => {
  it('prints help and returns 0 for --help', async () => {
    const io = captureIO();
    expect(await runCli(['--help'], io)).toBe(0);
    expect(io.out.join('\n')).toBe(helpText());
  });

  it('returns 2 and prints help when no config is given', async () => {
    const io = captureIO();
    expect(await runCli([], io)).toBe(2);
    expect(io.out.join('\n')).toContain('Usage:');
  });

  it('returns 2 for an unknown option, without printing help', async () => {
    const io = captureIO();
    expect(await runCli(['--nope'], io)).toBe(2);
    expect(io.err.join('\n')).toContain('--nope');
    expect(io.out).toEqual([]);
  });

  it('returns 0 for a passing palette', async () => {
    const io = captureIO();
    const code = await runCli([fixture('p.json', PASSING), '-o', join(dir, 'o')], io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('1/1 families pass');
  });

  it('returns 0 for a failing palette when not strict', async () => {
    const io = captureIO();
    const code = await runCli([fixture('f.json', FAILING), '-o', join(dir, 'o')], io);
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('0/1 families pass');
  });

  it('returns 1 for a failing palette under --strict', async () => {
    const io = captureIO();
    const code = await runCli([fixture('f.json', FAILING), '-o', join(dir, 'o'), '--strict'], io);
    expect(code).toBe(1);
  });

  it('returns 0 for a passing palette under --strict', async () => {
    const io = captureIO();
    const code = await runCli([fixture('p.json', PASSING), '-o', join(dir, 'o'), '--strict'], io);
    expect(code).toBe(0);
  });

  it('returns 1 with a message when the config cannot be read', async () => {
    const io = captureIO();
    expect(await runCli([join(dir, 'missing.json'), '-o', join(dir, 'o')], io)).toBe(1);
    expect(io.err).toHaveLength(1);
  });

  it('returns 1 when a module config has no default export', async () => {
    const p = join(dir, 'empty.mjs');
    writeFileSync(p, 'export const unrelated = 1;\n');
    const io = captureIO();
    expect(await runCli([p, '-o', join(dir, 'o')], io)).toBe(1);
    expect(io.err.join('\n')).toContain('no default export');
  });
});

describe('runCli output files', () => {
  it('writes tokens.json and dashboard.html by default', async () => {
    const out = join(dir, 'o');
    await runCli([fixture('p.json', PASSING), '-o', out], captureIO());
    expect(existsSync(join(out, 'tokens.json'))).toBe(true);
    expect(existsSync(join(out, 'dashboard.html'))).toBe(true);
  });

  it('skips the dashboard with --no-dashboard', async () => {
    const out = join(dir, 'o');
    await runCli([fixture('p.json', PASSING), '-o', out, '--no-dashboard'], captureIO());
    expect(existsSync(join(out, 'tokens.json'))).toBe(true);
    expect(existsSync(join(out, 'dashboard.html'))).toBe(false);
  });

  it('emits oklch component objects by default and hex strings with --srgb', async () => {
    const out = join(dir, 'o');
    const cfg = fixture('p.json', PASSING);

    await runCli([cfg, '-o', out], captureIO());
    const oklch = JSON.parse(readFileSync(join(out, 'tokens.json'), 'utf8'));
    expect(oklch.green['500'].$value).toMatchObject({ colorSpace: 'oklch' });

    await runCli([cfg, '-o', out, '--srgb'], captureIO());
    const srgb = JSON.parse(readFileSync(join(out, 'tokens.json'), 'utf8'));
    expect(srgb.green['500'].$value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('loads a .mjs config through its default export', async () => {
    const p = join(dir, 'palette.mjs');
    writeFileSync(p, `export default ${JSON.stringify(PASSING)};\n`);
    const out = join(dir, 'o');
    const io = captureIO();
    expect(await runCli([p, '-o', out], io)).toBe(0);
    expect(existsSync(join(out, 'tokens.json'))).toBe(true);
  });
});
