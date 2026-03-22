import { Command } from 'commander';
import { join } from 'path';
import { MessageBus } from '../bus/index.js';
import { loadConfig, getWorkspacePath } from '../config/index.js';
import { ExtensionLoader, normalizeExtensionConfig } from '../extensions/index.js';
import { registerExtensionCliProgram } from '../extension-sdk/channel-helpers.js';
import { createDefaultContext } from './registry.js';

/**
 * Load enabled extensions and attach Commander factories from registerCli (before parse).
 */
export async function registerExtensionCliCommands(program: Command): Promise<void> {
  const ctx = createDefaultContext(process.argv, {});
  const config = loadConfig(ctx.configPath);
  const workspace = getWorkspacePath(config) || ctx.workspacePath;
  const extensionsConfig = (config as Record<string, unknown>).extensions as Record<string, unknown> | undefined;
  if (!extensionsConfig) return;

  const resolved = normalizeExtensionConfig(extensionsConfig).filter((c) => c.enabled);
  if (resolved.length === 0) return;

  const bus = new MessageBus();
  const loader = new ExtensionLoader({
    workspaceDir: workspace,
    extensionsDir: join(workspace, '.extensions'),
  });
  loader.setConfig(config as Parameters<ExtensionLoader['setConfig']>[0]);
  loader.setRuntimeContext({ bus });
  await loader.loadExtensions(resolved);
  registerExtensionCliProgram(program, loader.getRegistry());
}
