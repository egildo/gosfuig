import { writeFileSync, mkdirSync } from 'node:fs';
import { seedFamily } from '../src/family.js';
import { resolvePalette } from '../src/palette.js';
import { checkContract, summarizeContract } from '../src/validate.js';
import { renderDashboard } from '../src/dashboard/render.js';
import { toW3CTokens } from '../src/export/w3c.js';

// A small but representative design-system palette: chromatic families,
// a near-neutral gray, and one family carrying a locked brand color.
const palette = resolvePalette({
  name: 'gosfuig demo',
  families: [
    { name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } }, // locked brand color (breaks contract on purpose)
    { name: 'green', hue: 150 },
    { name: 'amber', hue: 75, chroma: 0.16 },
    { name: 'red', hue: 27 },
    { name: 'violet', hue: 300 },
    { name: 'gray', hue: 260, chroma: 0.01 }, // near-neutral
    // Seed-driven: one brand color -> a full family. Hue and chroma are read
    // from the seed; it is pinned at step 500; the ramp is built around it.
    seedFamily({ name: 'brand', seed: '#e11d48', step: '500' }),
  ],
});

// Validate the contract for every family (report only).
console.log('Contract check (4 darkest as fg on 4 lightest as bg, WCAG AA):\n');
for (const fam of palette.families) {
  console.log('  ' + summarizeContract(checkContract(fam)));
}

// Emit artifacts.
const outDir = new URL('../out/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('dashboard.html', outDir), renderDashboard(palette));
writeFileSync(new URL('tokens.json', outDir), JSON.stringify(toW3CTokens(palette), null, 2));

console.log('\nWrote out/dashboard.html and out/tokens.json');
