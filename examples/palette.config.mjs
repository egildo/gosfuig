// Example gosfuig palette config (JS form — can use seedFamily + curves).
//
// Imports the package by name, exactly as a consumer's own config would. Inside
// this repo that resolves through the "exports" field via Node's package
// self-reference, so it needs `npm run build` first:
//
//   npm run build && node dist/bin.js examples/palette.config.mjs
//
// For a config that needs no build at all, see palette.config.json.
import { seedFamily } from 'gosfuig';

export default {
  name: 'gosfuig demo',
  families: [
    { name: 'blue', hue: 259, locks: { 700: '#1d4ed8' } },
    { name: 'gray', hue: 260, chroma: 0.01 },
    seedFamily({ name: 'brand', seed: '#e11d48', step: '500' }),
  ],
};
