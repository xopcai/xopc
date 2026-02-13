import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib';
  
  if (isLib) {
    // Library build mode
    return {
      root: '.',
      build: {
        outDir: 'dist/lib',
        lib: {
          entry: 'src/index.ts',
          name: 'XopcbotUI',
          fileName: (format) => `xopcbot-ui.${format}.js`,
          formats: ['es', 'umd'],
        },
        rollupOptions: {
          external: ['lit', '@lit-labs/virtualizer', '@mariozechner/pi-agent-core', '@mariozechner/pi-ai'],
          output: {
            globals: {
              lit: 'Lit',
              '@lit-labs/virtualizer': 'LitVirtualizer',
            },
          },
        },
        sourcemap: true,
        minify: 'terser',
      },
      css: {
        postcss: true,
      },
    };
  }
  
  // App/Demo build mode (default)
  return {
    root: '.',
    build: {
      outDir: '../dist/gateway/static/root',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: 'index.html',
        },
      },
      sourcemap: true,
    },
    server: {
      port: 3000,
      open: false,
      proxy: {
        '/ws': {
          target: 'ws://localhost:18790',
          ws: true,
          changeOrigin: true,
        },
      },
    },
    css: {
      postcss: true,
    },
    optimizeDeps: {
      include: ['lit', '@lit-labs/virtualizer', 'lucide'],
    },
  };
});
