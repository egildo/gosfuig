import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The studio dev server (`npm run dev`) serves src/studio over the live library.
// `npm run studio:build` emits a single self-contained HTML (engine bundled, no
// CDN, openable from file://) into dist-studio/.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-studio',
    emptyOutDir: true,
    // Inline everything (incl. the bundled woff2 fonts) as base64 so the built
    // studio is a single self-contained HTML with no external requests.
    assetsInlineLimit: 100_000_000,
  },
});
