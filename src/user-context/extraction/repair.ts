import {
  getUnderstanding,
  hasIndependentExtractionOutput,
  listContextExtractionOutputs,
  listContextExtractionRuns,
  setUnderstandingStatus,
} from '../../storage/sqlite/index.js';
import { listUserFocuses, updateUserFocus } from '../sources/repository.js';

export type ContextRepairFilter = {
  runId?: string;
  sourceRef?: string;
  extractorId?: string;
  extractorVersion?: string;
  objectVersionId?: string;
};

export function repairExtractedContext(filter: ContextRepairFilter): {
  runIds: string[];
  repaired: Array<{ objectType: 'focus' | 'understanding'; objectId: string }>;
  retained: Array<{ objectType: 'focus' | 'understanding'; objectId: string; reason: string }>;
} {
  const runs = listContextExtractionRuns({
    ...(filter.sourceRef ? { sourceRef: filter.sourceRef } : {}),
    ...(filter.extractorId ? { extractorId: filter.extractorId } : {}),
    ...(filter.extractorVersion ? { extractorVersion: filter.extractorVersion } : {}),
    limit: 500,
  }).filter((run) => !filter.runId || run.id === filter.runId);
  const repaired: Array<{ objectType: 'focus' | 'understanding'; objectId: string }> = [];
  const retained: Array<{ objectType: 'focus' | 'understanding'; objectId: string; reason: string }> = [];
  const seen = new Set<string>();
  const targetRunIds = runs.map((run) => run.id);
  for (const run of runs) {
    for (const output of listContextExtractionOutputs(run.id)) {
      if ((output.objectType !== 'focus' && output.objectType !== 'understanding') || !output.objectId) continue;
      if (filter.objectVersionId && output.versionId !== filter.objectVersionId) continue;
      const key = `${output.objectType}:${output.objectId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (hasIndependentExtractionOutput(targetRunIds, output.objectType, output.objectId)) {
        retained.push({ objectType: output.objectType, objectId: output.objectId, reason: 'independent_extraction' });
        continue;
      }
      if (output.objectType === 'understanding') {
        const understanding = getUnderstanding(output.objectId);
        if (!understanding) continue;
        if (understanding.explicitness === 'explicit') {
          retained.push({ objectType: 'understanding', objectId: output.objectId, reason: 'user_explicit' });
          continue;
        }
        setUnderstandingStatus(output.objectId, 'archived');
      } else {
        const focus = listUserFocuses().find((item) => item.id === output.objectId);
        if (!focus) continue;
        if (focus.explicitness === 'explicit') {
          retained.push({ objectType: 'focus', objectId: output.objectId, reason: 'user_explicit' });
          continue;
        }
        updateUserFocus(output.objectId, { status: 'paused' });
      }
      repaired.push({ objectType: output.objectType, objectId: output.objectId });
    }
  }
  return { runIds: runs.map((run) => run.id), repaired, retained };
}
