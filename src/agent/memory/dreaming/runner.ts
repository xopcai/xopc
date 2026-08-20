import type { Config } from '../../../config/schema.js';
import {
  finishDreamingRun,
  startDreamingRun,
  type DreamingPhase,
  type DreamingRun,
} from '../../../storage/sqlite/index.js';
import { resolveDreamingConfig } from './config.js';
import { DREAMING_ALGORITHM_VERSION } from './constants.js';
import { runDreamingDeepPromotion } from './deep-promotion.js';
import { runLightSweep } from './light-sweep.js';
import { runRemPatterns } from './rem-patterns.js';
import { resolveDreamingAgentScope } from './scope.js';

export async function runDreamingPhase(input: {
  config: Config;
  phase: DreamingPhase;
  triggerKind: 'schedule' | 'manual';
}): Promise<{ run: DreamingRun; result: Record<string, unknown> }> {
  const scope = resolveDreamingAgentScope(input.config);
  const resolved = scope.config;
  if (resolved.mode === 'off') throw new Error('Dreaming is off');
  if (input.triggerKind === 'schedule' && !resolved.phases[input.phase].enabled) {
    throw new Error(`Dreaming ${input.phase} schedule is disabled`);
  }
  const forceManualRun = input.triggerKind === 'manual';

  const run = startDreamingRun({
    agentId: scope.agentId,
    workspaceId: scope.workspaceDir,
    phase: input.phase,
    mode: resolved.mode,
    triggerKind: input.triggerKind,
    algorithmVersion: DREAMING_ALGORITHM_VERSION,
    configSnapshot: resolved,
  });
  try {
    let result: Record<string, unknown>;
    if (input.phase === 'light') {
      result = await runLightSweep({
        runId: run.runId,
        workspaceDir: scope.workspaceDir,
        config: { ...resolved.phases.light, enabled: forceManualRun || resolved.phases.light.enabled },
      });
    } else if (input.phase === 'deep') {
      result = await runDreamingDeepPromotion({
        runId: run.runId,
        mode: resolved.mode,
        agentId: scope.agentId,
        workspaceDir: scope.workspaceDir,
        config: { ...resolved.phases.deep, enabled: forceManualRun || resolved.phases.deep.enabled },
        sensitiveWritePolicy: input.config.userContext.privacy.sensitiveWritePolicy,
      });
    } else {
      result = await runRemPatterns({
        runId: run.runId,
        mode: resolved.mode,
        agentId: scope.agentId,
        workspaceDir: scope.workspaceDir,
        config: { ...resolved.phases.rem, enabled: forceManualRun || resolved.phases.rem.enabled },
        sensitiveWritePolicy: input.config.userContext.privacy.sensitiveWritePolicy,
      });
    }
    const ok = result.ok === true;
    const reason = typeof result.reason === 'string' ? result.reason : ok ? 'completed' : 'failed';
    const completed = finishDreamingRun({ runId: run.runId, ok, reason, metrics: result });
    return { run: completed ?? run, result };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    finishDreamingRun({ runId: run.runId, ok: false, reason });
    throw error;
  }
}
