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
        chunkSizeWarningLimit: 500,
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
      sourcemap: true,
      rollupOptions: {
        input: {
          main: 'index.html',
        },
        output: {
          manualChunks: {
            // Vendor chunks for better caching
            'vendor-lit': ['lit', '@lit-labs/virtualizer'],
            'vendor-pdf': ['pdfjs-dist'],
            'vendor-xlsx': ['xlsx'],
            'vendor-utils': ['jszip', 'docx-preview'],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    server: {
      port: 3000,
      open: false,
      proxy: {
        '/api': {
          target: 'http://localhost:18790',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:18790',
          changeOrigin: true,
        },
        '/status': {
          target: 'http://localhost:18790',
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
