#!/usr/bin/env node
/**
 * The `gosfuig` executable. Deliberately the only file that touches `process`:
 * everything it needs lives in `cli.ts`, which is side-effect free and tested
 * in-process.
 */
import { runCli } from './cli.js';

runCli(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
