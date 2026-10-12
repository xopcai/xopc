import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGlobalPackageUpdateSteps } from '../package-update-steps.js';
import { createDefaultCommandRunner } from '../run-command.js';
import { resolveNpmGlobalPrefixLayoutFromPrefix } from '../update-global.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

describe('staged npm runtime validation before activation', () => {
  it.each([false, true])('only activates a loadable gateway (broken candidate: %s)', async (broken) => {
    const prefix = await fs.mkdtemp(path.join(os.tmpdir(), 'xopc-stage-test-'));
    dirs.push(prefix);
    const layout = resolveNpmGlobalPrefixLayoutFromPrefix(prefix);
    const packageRoot = path.join(layout.globalRoot, '@xopcai/xopc');
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@xopcai/xopc', version: '1.0.0', type: 'module' }));
    await fs.writeFile(path.join(packageRoot, 'old-install-marker'), 'preserve');
    await fs.mkdir(layout.binDir, { recursive: true });
    await fs.writeFile(path.join(layout.binDir, 'xopc'), 'old-shim');

    const result = await runGlobalPackageUpdateSteps({
      installTarget: { manager: 'npm', command: 'npm', globalRoot: layout.globalRoot, packageRoot },
      installSpec: '@xopcai/xopc@2.0.0', packageName: '@xopcai/xopc', packageRoot,
      runCommand: createDefaultCommandRunner(), timeoutMs: 10_000,
      runStep: async ({ name, argv, cwd }) => {
        const stagePrefix = argv[argv.indexOf('--prefix') + 1];
        expect(stagePrefix).not.toBe(prefix);
        const stage = resolveNpmGlobalPrefixLayoutFromPrefix(stagePrefix);
        const candidate = path.join(stage.globalRoot, '@xopcai/xopc');
        const gatewayDir = path.join(candidate, 'dist/src/gateway');
        await fs.mkdir(gatewayDir, { recursive: true });
        await fs.writeFile(path.join(candidate, 'package.json'), JSON.stringify({ name: '@xopcai/xopc', version: '2.0.0', type: 'module' }));
        await fs.writeFile(path.join(gatewayDir, 'index.js'), broken
          ? "import { MCP_TYPESCRIPT_PREAMBLE } from './declarations.js'; export class GatewayServer {} console.log(MCP_TYPESCRIPT_PREAMBLE);"
          : 'export class GatewayServer {}');
        await fs.writeFile(path.join(gatewayDir, 'declarations.js'), 'export const renamed = true;');
        await fs.mkdir(stage.binDir, { recursive: true });
        await fs.writeFile(path.join(stage.binDir, 'xopc'), 'new-shim');
        return { name, command: argv.join(' '), cwd: cwd ?? prefix, durationMs: 0, exitCode: 0 };
      },
    });

    const live = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    expect(live.version).toBe(broken ? '1.0.0' : '2.0.0');
    expect(result.afterVersion).toBe(live.version);
    expect(await fs.readFile(path.join(layout.binDir, 'xopc'), 'utf8')).toBe(broken ? 'old-shim' : 'new-shim');
    if (broken) {
      expect(result.failedStep?.name).toBe('global install verify');
      expect(result.failedStep?.stderrTail).toContain('MCP_TYPESCRIPT_PREAMBLE');
      expect(await fs.readFile(path.join(packageRoot, 'old-install-marker'), 'utf8')).toBe('preserve');
      expect(result.steps.some((step) => step.name === 'global install swap')).toBe(false);
    } else {
      expect(result.failedStep).toBeNull();
    }
    expect((await fs.readdir(layout.globalRoot)).some((name) => name.startsWith('.xopc-'))).toBe(false);
  });
});
