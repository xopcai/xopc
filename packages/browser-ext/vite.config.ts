import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Extension pages are served below the extension root (for example
  // `dist/sidepanel.html`), so emitted asset URLs must remain relative.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        sidepanel: resolve(__dirname, 'sidepanel.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
  },
});
