import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    lib: {
      entry: 'src/index.ts',
      name: 'XopcbotUI',
      fileName: (format) => `xopcbot-ui.${format}.js`,
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      input: {
        main: 'index.html',
      },
      output: {
        dir: 'dist',
        globals: {
          lit: 'LitElement',
        },
      },
    },
  },
  server: {
    port: 3000,
    open: false,
  },
  css: {
    postcss: false,
  },
});
