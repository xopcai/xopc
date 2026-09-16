import { defineConfig } from 'vitest/config';
import ts from 'typescript';

export default defineConfig({
  resolve: { extensions: ['.mjs', '.js', '.ts', '.tsx', '.json', '.ets'] },
  plugins: [{
    name: 'arkts-service-tests',
    transform(source, id) {
      if (!id.endsWith('.ets')) return;
      return ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        fileName: id.replace(/\.ets$/, '.ts'),
      }).outputText;
    },
  }],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
