import { Command } from 'commander';
import { join } from 'path';
import { MessageBus } from '../infra/bus/index.js';
import { loadConfig, getWorkspacePath } from '../config/index.js';
import { collectConfiguredChannelIds } from '../extensions/activation-context.js';
import { ExtensionLoader } from '../extensions/index.js';
import { registerExtensionCliProgram } from '../extensions/sdk/channel-helpers.js';
import { createDefaultContext } from './registry.js';

/**
 * Load extensions that may register CLI commands (manifest-only skip when nothing would activate).
 */
export async function registerExtensionCliCommands(program: Command): Promise<void> {
  const ctx = createDefaultContext(process.argv, {});
  const config = loadConfig(ctx.configPath);
  const workspace = getWorkspacePath(config) || ctx.workspacePath;

  const rawExt = (config as Record<string, unknown>).extensions;
  const extBlock =
    rawExt && typeof rawExt === 'object' && !Array.isArray(rawExt)
      ? (rawExt as Record<string, unknown>)
      : undefined;
  const enabledIds = Array.isArray(extBlock?.enabled)
    ? extBlock!.enabled.filter((x): x is string => typeof x === 'string')
    : [];

  const bus = new MessageBus();
  const loader = new ExtensionLoader({
    workspaceDir: workspace,
    extensionsDir: join(workspace, '.extensions'),
  });
  loader.setConfig(config as Parameters<ExtensionLoader['setConfig']>[0]);

  const registry = loader.buildManifestRegistry();
  const envWouldActivate = registry.detectAvailableByEnv(process.env).length > 0;
  const channelWouldActivate = (collectConfiguredChannelIds(config)?.length ?? 0) > 0;

  if (enabledIds.length === 0 && !channelWouldActivate && !envWouldActivate) {
    return;
  }

  loader.setRuntimeContext({ bus });
  await loader.loadByActivationPlan();
  registerExtensionCliProgram(program, loader.getRegistry());
}
