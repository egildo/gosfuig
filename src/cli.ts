#!/usr/bin/env node
/**
 * gosfuig CLI: resolve a palette spec, print the contract summary, and emit
 * DTCG tokens (+ an HTML dashboard) to an output directory.
 *
 *   gosfuig <config> [options]
 *
 * The config is a palette spec:
 *   - .json  — a plain PaletteSpec (hue/chroma numbers, locks; no curves)
 *   - .js/.mjs — an ES module whose default export is a PaletteSpec; this form
 *     can use seedFamily(), curve builders, and hue/chroma functions.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resolvePalette,
  checkContract,
  summarizeContract,
  renderDashboard,
  toW3CTokens,
  type PaletteSpec,
} from './index.js';

interface Opts {
  config?: string;
  out: string;
  srgb: boolean;
  dashboard: boolean;
  strict: boolean;
}

function printHelp(): void {
  console.log(`gosfuig — perceptual OKLCH palette generator

Usage:
  gosfuig <config> [options]

Arguments:
  <config>            Palette spec: .json (plain) or .js/.mjs (default export)

Options:
  -o, --out <dir>     Output directory (default: out)
  --srgb              Export hex-only tokens instead of OKLCH + hex
  --no-dashboard      Skip writing dashboard.html
  --strict            Exit 1 if any family fails the contract (CI-friendly)
  -h, --help          Show this help

Outputs <out>/tokens.json and (unless --no-dashboard) <out>/dashboard.html.`);
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { out: 'out', srgb: false, dashboard: true, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-o':
      case '--out':
        o.out = argv[++i]!;
        break;
      case '--srgb':
        o.srgb = true;
        break;
      case '--no-dashboard':
        o.dashboard = false;
        break;
      case '--strict':
        o.strict = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        if (a && !a.startsWith('-')) o.config = a;
        else {
          console.error(`gosfuig: unknown option "${a}"`);
          process.exit(2);
        }
    }
  }
  return o;
}

async function loadSpec(path: string): Promise<PaletteSpec> {
  const abs = resolve(path);
  if (abs.endsWith('.json')) {
    return JSON.parse(readFileSync(abs, 'utf8')) as PaletteSpec;
  }
  const mod = (await import(pathToFileURL(abs).href)) as {
    default?: PaletteSpec;
    palette?: PaletteSpec;
  };
  const spec = mod.default ?? mod.palette;
  if (!spec) {
    throw new Error(`gosfuig: ${path} has no default export (a PaletteSpec)`);
  }
  return spec;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.config) {
    printHelp();
    process.exit(2);
  }

  const palette = resolvePalette(await loadSpec(opts.config));
  const results = palette.families.map((f) => checkContract(f));

  console.log(`Contract check (darkest steps AA on lightest):\n`);
  for (const r of results) console.log('  ' + summarizeContract(r));

  mkdirSync(opts.out, { recursive: true });
  writeFileSync(
    join(opts.out, 'tokens.json'),
    JSON.stringify(toW3CTokens(palette, { colorSpace: opts.srgb ? 'srgb' : 'oklch' }), null, 2),
  );
  if (opts.dashboard) {
    writeFileSync(join(opts.out, 'dashboard.html'), renderDashboard(palette));
  }

  const failed = results.filter((r) => !r.passes).length;
  const passed = results.length - failed;
  console.log(`\ngosfuig: ${passed}/${results.length} families pass → wrote ${opts.out}/`);
  if (opts.strict && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
