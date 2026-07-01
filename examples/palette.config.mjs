// Example gosfuig palette config (JS form — can use seedFamily + curves).
// Run after building the library:  node dist/cli.js examples/palette.config.mjs
import { seedFamily } from '../dist/index.js';

export default {
  name: 'gosfuig demo',
  families: [
    { name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } },
    { name: 'gray', hue: 260, chroma: 0.01 },
    seedFamily({ name: 'brand', seed: '#e11d48', step: '500' }),
  ],
};
