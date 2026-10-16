import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectRecordingOutcome, type XopcRecordingOutcomeInput } from '../entry/src/main/ets/common/recordingOutcome.ets';
import { discussionOutcomeInput } from '../entry/src/main/ets/common/discussionOutcome.ets';
import { recordingOutcomeStages,recordingOutcomePhrases } from '../../../web/src/features/discussions/recording-outcome-copy';
import { projectRecordingOutcome as webProject } from '../../../packages/gateway-contract/src/recording-outcome';

describe('shared recording completion outcomes', () => {
  it('executes the identical projection on both platforms across local, transport and AI failures', () => {
    for (const localSave of ['saving','partial','complete','unknown']) for (const sync of ['pending','offline','verifying','available','failed'])
      for (const serverStatus of ['stopping','sealing','organizing','needs_attention','completed']) for (const audioAvailable of [false,true]) {
        const value: XopcRecordingOutcomeInput = { localSave,sync,serverStatus,audioAvailable,audioDeleted: false,
          failureStage: 'organization',jobState: '',retryScheduled: false,textAvailable: true,noteAvailable: true,analysisStale: true };
        expect(projectRecordingOutcome(value)).toEqual(webProject(value));
        if (localSave === 'saving') expect(projectRecordingOutcome(value).leave).toBe('hold');
        if (!audioAvailable && localSave !== 'complete') expect(projectRecordingOutcome(value).leave).toBe('hold');
      }
  });
  it('adapts confirmed source, available transcript and earlier note revisions without inventing durability', () => {
    const value = discussionOutcomeInput({ discussion: { id: 'd',noteId: 'n',status: 'needs_attention',failureStage: 'organization',audioAttachmentId: 'a' },
      transcript: { discussionId: 'd',revision: 2,text: 'Existing words',segments: [] },
      organization: { status: 'completed',transcriptRevision: 1,organization: { summary: 'Earlier note',keyPoints: [],decisions: [],actionItems: [],risks: [],openQuestions: [] } } });
    expect(projectRecordingOutcome(value)).toMatchObject({ stage: 'analysis_failed',leave: 'cloud',retry: 'pipeline',text: true,note: true,stale: true });
    value.audioDeleted = true;expect(projectRecordingOutcome(value)).toMatchObject({ stage: 'audio_deleted',audio: false,retry: 'none' });
  });
  it('checks the generated ArkTS source has not drifted from the authoritative contract', () => {
    const native = readFileSync(new URL('../entry/src/main/ets/common/recordingOutcome.ets',import.meta.url),'utf8');
    const shared = readFileSync(new URL('../../../packages/gateway-contract/src/recording-outcome.ts',import.meta.url),'utf8');
    expect(native.slice(native.indexOf('/**'))).toBe(shared);
  });
  it('uses identical English and Chinese product copy on Web and Harmony', () => {
    for (const [locale,offset] of [['base',1],['zh_CN',0]] as const) {
      const resource = JSON.parse(readFileSync(new URL('../entry/src/main/resources/'+locale+'/element/string.json',import.meta.url),'utf8'));
      const values = new Map(resource.string.map((row: { name: string;value: string }) => [row.name,row.value]));
      for (const [stage,copy] of Object.entries(recordingOutcomeStages)) {
        expect(values.get('recording_outcome_'+stage+'_title')).toBe(copy[offset]);
        expect(values.get('recording_outcome_'+stage+'_body')).toBe(copy[offset+2]);
      }
      for (const [key,copy] of Object.entries(recordingOutcomePhrases)) expect(values.get('recording_outcome_'+key)).toBe(copy[offset]);
    }
  });

});
