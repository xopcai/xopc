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
        globals: {
          lit: 'LitElement',
          '@mariozechner/pi-agent-core': 'piAgentCore',
          '@mariozechner/pi-ai': 'piAI',
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  css: {
    postcss: false,
  },
});
