import type { RuntimeToolsConfig } from '../config/schema.js';
import { ManagedRuntimeManager } from './manager.js';
import type { ResolvedRuntime, RuntimeKind } from './types.js';

export type RuntimeBootstrapResult = {
  runtime: RuntimeKind;
  ok: boolean;
  resolved?: ResolvedRuntime;
  error?: string;
};

type RuntimeResolver = Pick<ManagedRuntimeManager, 'resolve'>;

export async function provisionEagerRuntimes(params: {
  stateDir: string;
  config: RuntimeToolsConfig;
  manager?: RuntimeResolver;
}): Promise<RuntimeBootstrapResult[]> {
  if (!params.config.enabled) return [];
  const manager = params.manager ?? new ManagedRuntimeManager({
    stateDir: params.stateDir,
    config: params.config,
  });
  const requested: RuntimeKind[] = [];
  if (params.config.node.enabled && params.config.node.provision === 'eager') requested.push('node');
  if (params.config.python.enabled && params.config.python.provision === 'eager') requested.push('python');

  const results: RuntimeBootstrapResult[] = [];
  for (const runtime of requested) {
    try {
      const resolved = await manager.resolve({ runtime, allowProvision: true });
      results.push({ runtime, ok: true, resolved });
    } catch (error) {
      results.push({
        runtime,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
