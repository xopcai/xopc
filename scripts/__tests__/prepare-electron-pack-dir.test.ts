import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ELECTRON_PACKAGED_DEPENDENCIES } from '../electron-runtime-externals.mjs';
import { prepareElectronPackDir, pruneElectronRuntimeDeps } from '../prepare-electron-pack-dir.mjs';

describe('prepare-electron-pack-dir', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps only target ONNX binaries and the Transformers Node entrypoints', () => {
    const root = join(tmpdir(), `xopc-electron-prune-${process.pid}-${Date.now()}`);
    tempRoots.push(root);
    for (const relativePath of [
      'node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/runtime',
      'node_modules/onnxruntime-node/bin/napi-v3/darwin/x64/runtime',
      'node_modules/onnxruntime-node/bin/napi-v3/linux/x64/runtime',
      'node_modules/onnxruntime-web/runtime.wasm',
      'node_modules/@huggingface/transformers/dist/transformers.node.mjs',
      'node_modules/@huggingface/transformers/dist/transformers.node.cjs',
      'node_modules/@huggingface/transformers/dist/transformers.web.js',
      'node_modules/@huggingface/transformers/dist/transformers.node.mjs.map',
      'node_modules/@huggingface/transformers/src/index.js',
      'node_modules/@huggingface/transformers/types/index.d.ts',
    ]) {
      const path = join(root, relativePath);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'fixture');
    }
    writeFileSync(
      join(root, 'node_modules/@huggingface/transformers/package.json'),
      JSON.stringify({ dependencies: { 'onnxruntime-node': '1', 'onnxruntime-web': '1', sharp: '1' } }),
    );

    pruneElectronRuntimeDeps(root, { platform: 'darwin', arch: 'arm64' });

    expect(existsSync(join(root, 'node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/runtime'))).toBe(true);
    expect(existsSync(join(root, 'node_modules/onnxruntime-node/bin/napi-v3/darwin/x64'))).toBe(false);
    expect(existsSync(join(root, 'node_modules/onnxruntime-node/bin/napi-v3/linux'))).toBe(false);
    expect(existsSync(join(root, 'node_modules/onnxruntime-web'))).toBe(false);
    expect(existsSync(join(root, 'node_modules/@huggingface/transformers/dist/transformers.node.mjs'))).toBe(true);
    expect(existsSync(join(root, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs'))).toBe(true);
    expect(existsSync(join(root, 'node_modules/@huggingface/transformers/dist/transformers.web.js'))).toBe(false);
    expect(existsSync(join(root, 'node_modules/@huggingface/transformers/src'))).toBe(false);
    expect(existsSync(join(root, 'node_modules/@huggingface/transformers/types'))).toBe(false);
    const pkg = JSON.parse(
      readFileSync(join(root, 'node_modules/@huggingface/transformers/package.json'), 'utf8'),
    );
    expect(pkg.dependencies).toEqual({ 'onnxruntime-node': '1', sharp: '1' });
  });

  it('stages minimal runtime node_modules when app artifacts exist', () => {
    const repoRoot = process.cwd();
    if (
      !existsSync(join(repoRoot, 'out/main/index.js')) ||
      !existsSync(join(repoRoot, 'out/server/index.js')) ||
      !existsSync(join(repoRoot, 'dist/electron/extensions')) ||
      !existsSync(join(repoRoot, 'dist/gateway/static/root/index.html'))
    ) {
      return;
    }

    const packDir = prepareElectronPackDir(repoRoot);
    tempRoots.push(packDir);

    const pkg = JSON.parse(readFileSync(join(packDir, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...ELECTRON_PACKAGED_DEPENDENCIES].sort());
    expect(existsSync(join(packDir, 'out/main/index.js'))).toBe(true);
    expect(existsSync(join(packDir, 'dist/electron/extensions'))).toBe(true);
    expect(existsSync(join(packDir, 'dist/src'))).toBe(false);
    expect(existsSync(join(packDir, 'dist/extensions'))).toBe(false);
    expect(existsSync(join(packDir, 'dist/gateway/static/root/index.html'))).toBe(true);
    expect(existsSync(join(packDir, 'skills/tools/find-skills/SKILL.md'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/silk-wasm'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/@huggingface/transformers'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/onnxruntime-common'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/onnxruntime-web'))).toBe(false);
    expect(
      existsSync(
        join(packDir, 'node_modules/onnxruntime-node/bin/napi-v3', process.platform, process.arch),
      ),
    ).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/sherpa-onnx-node'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/onnxruntime-node/bin/napi-v3'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/@vscode/ripgrep'))).toBe(false);
    expect(existsSync(join(packDir, '_pack-resources/rg'))).toBe(true);
    expect(existsSync(join(packDir, '_pack-resources/cbm'))).toBe(true);
    expect(existsSync(join(packDir, '_pack-resources/cbm/codebase-memory-mcp.manifest.json'))).toBe(true);
    expect(existsSync(join(packDir, 'node_modules/@earendil-works/pi-ai'))).toBe(false);
    // Pack dir lives outside the repo so `pnpm --workspace-root` (run by electron-builder)
    // returns nothing and the dep collector stays scoped to pack dir.
    expect(packDir.startsWith(repoRoot)).toBe(false);
    // Build inputs are staged so pack.yml can reference them via relative `_pack-resources/...`.
    expect(existsSync(join(packDir, '_pack-resources/electron-before-build.cjs'))).toBe(true);
    expect(existsSync(join(packDir, '_pack-resources/build-resources'))).toBe(true);
    expect(existsSync(join(packDir, '_pack-resources/playwright-core'))).toBe(true);
    expect(existsSync(join(packDir, '_pack-resources/browser-ext'))).toBe(true);
  });
});
