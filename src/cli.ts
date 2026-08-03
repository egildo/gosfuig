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
 *
 * This module is side-effect free: it parses, runs, and returns an exit code.
 * The executable entry point is `bin.ts`, which is the only thing that touches
 * `process`. That split is what makes the CLI testable in-process.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resolvePalette,
  checkContract,
  summarizeContract,
  summarizeNotes,
  renderDashboard,
  toW3CTokens,
  parsePaletteSpec,
  parseConfig,
  stringifyConfig,
  type PaletteSpec,
  type W3CExportOptions,
} from './index.js';

export interface Opts {
  config?: string;
  out: string;
  srgb: boolean;
  dashboard: boolean;
  strict: boolean;
  /** Also write the normalized spec back out as `palette.config.json`. */
  emitConfig: boolean;
  /** `-h` / `--help` was passed. */
  help: boolean;
  /** Usage errors collected while parsing (unknown options, missing values). */
  errors: string[];
}

/** Where the CLI writes. Injectable so tests can capture output. */
export interface CliIO {
  log(message: string): void;
  error(message: string): void;
}

const consoleIO: CliIO = {
  log: (m) => console.log(m),
  error: (m) => console.error(m),
};

export function helpText(): string {
  return `gosfuig — perceptual OKLCH palette generator

Usage:
  gosfuig <config> [options]

Arguments:
  <config>            Palette spec: .json (plain) or .js/.mjs (default export)

Options:
  -o, --out <dir>     Output directory (default: out)
  --srgb              Export hex-only tokens instead of OKLCH + hex
  --no-dashboard      Skip writing dashboard.html
  --emit-config       Also write the normalized spec as palette.config.json
  --strict            Exit 1 if any family fails the contract (CI-friendly)
  -h, --help          Show this help

Outputs <out>/tokens.json and (unless --no-dashboard) <out>/dashboard.html.
With --emit-config, also <out>/palette.config.json — the same spec in the
canonical file format, so a .mjs config can be frozen to JSON and a studio
session can be handed to CI.`;
}

export function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    out: 'out',
    srgb: false,
    dashboard: true,
    strict: false,
    emitConfig: false,
    help: false,
    errors: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-o':
      case '--out': {
        const value = argv[++i];
        if (value == null) o.errors.push(`gosfuig: ${a} needs a directory`);
        else o.out = value;
        break;
      }
      case '--srgb':
        o.srgb = true;
        break;
      case '--no-dashboard':
        o.dashboard = false;
        break;
      case '--emit-config':
        o.emitConfig = true;
        break;
      case '--strict':
        o.strict = true;
        break;
      case '-h':
      case '--help':
        o.help = true;
        break;
      default:
        if (a && !a.startsWith('-')) o.config = a;
        else o.errors.push(`gosfuig: unknown option "${a}"`);
    }
  }
  return o;
}

/**
 * Read a config and validate it into a PaletteSpec. Everything that leaves here
 * is known-good, so `resolvePalette` never has to defend itself against input.
 */
export async function loadSpec(path: string): Promise<PaletteSpec> {
  const abs = resolve(path);
  let raw: unknown;

  if (abs.endsWith('.json')) {
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      throw new Error(`gosfuig: cannot read ${path}`);
    }
    // The .json branch IS the config file format, so it goes through the same
    // parser the studio uses — one reader, one set of error messages.
    return parseConfig(text, path);
  } else {
    const mod = (await import(pathToFileURL(abs).href)) as {
      default?: unknown;
      palette?: unknown;
    };
    raw = mod.default ?? mod.palette;
    if (raw === undefined) {
      throw new Error(`gosfuig: ${path} has no default export (a PaletteSpec)`);
    }
  }

  return parsePaletteSpec(raw);
}

/**
 * Run the CLI and return a process exit code.
 *   0 — success
 *   1 — a thrown error, or --strict with at least one failing family
 *   2 — usage error (no config, unknown option)
 */
export async function runCli(argv: string[], io: CliIO = consoleIO): Promise<number> {
  const opts = parseArgs(argv);

  if (opts.help) {
    io.log(helpText());
    return 0;
  }
  if (opts.errors.length > 0) {
    for (const e of opts.errors) io.error(e);
    return 2;
  }
  if (!opts.config) {
    io.log(helpText());
    return 2;
  }

  let spec: PaletteSpec;
  try {
    spec = await loadSpec(opts.config);
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const palette = resolvePalette(spec);
  const results = palette.families.map((f) => checkContract(f));

  io.log(`Contract check (darkest steps AA on lightest):\n`);
  palette.families.forEach((family, i) => {
    io.log('  ' + summarizeContract(results[i]!));
    // Fidelity is reported separately from the contract: what the engine could
    // not deliver exactly, whether or not the family passes.
    const notes = summarizeNotes(family);
    if (notes) io.log('    ↳ ' + notes);
  });

  // The config's own `export` block is the base; CLI flags override it, since
  // a flag is the more specific instruction.
  const exportOpts: W3CExportOptions = {
    ...spec.export,
    ...(opts.srgb ? { colorSpace: 'srgb' as const } : {}),
  };

  let tokens: string;
  try {
    tokens = JSON.stringify(toW3CTokens(palette, exportOpts), null, 2);
  } catch (err) {
    // Reshaping can fail on a name collision, which is a config error, not a bug.
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, 'tokens.json'), tokens);
  if (opts.dashboard) {
    writeFileSync(join(opts.out, 'dashboard.html'), renderDashboard(palette));
  }
  if (opts.emitConfig) {
    writeFileSync(join(opts.out, 'palette.config.json'), stringifyConfig(spec));
  }

  const failed = results.filter((r) => !r.passes).length;
  const passed = results.length - failed;
  io.log(`\ngosfuig: ${passed}/${results.length} families pass → wrote ${opts.out}/`);

  return opts.strict && failed > 0 ? 1 : 0;
}
