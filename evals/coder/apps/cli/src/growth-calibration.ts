import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { TraceEmitter, type AgentAdapter } from '@agent-evals/protocol';

/** Reference controls only; never measures model performance. */
export function growthCalibrationAdapter(): AgentAdapter {
  return {
    id: 'xopc-growth-calibration',
    async run(request, onEvent) {
      if (request.variant.id !== 'broken') execFileSync(process.execPath, [
        fileURLToPath(new URL('../../../suites/xopc-agent-growth/reference.mjs', import.meta.url)),
        request.evalCase.id.split('-')[0]!, request.environment.workspace,
      ]);
      if (request.variant.id !== 'broken' && /^[EP]/.test(request.evalCase.id)) {
        await new TraceEmitter(request.runId, onEvent).emit('tool.finished', {payload: {
          status: 'success', toolName: 'exec_command', result: {details: {verification: {kind:'check',status:'passed'}}},
        }});
      }
      return { status: 'completed', finalText: 'Evaluator calibration only.' };
    },
  };
}
