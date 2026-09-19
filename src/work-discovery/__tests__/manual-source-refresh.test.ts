import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { ProjectService } from '../../projects/project-service.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getUnderstandingSourceGrant, revokeUnderstandingSourceGrant, upsertUnderstandingSourceGrant } from '../../user-context/sources/repository.js';
import type { UnderstandingSourceItem } from '../../user-context/sources/types.js';
import { listUserAssertions } from '../../user-model/index.js';
import { analyzeUnderstandingSources } from '../analyzer.js';
import { WorkDiscoveryService } from '../service.js';

vi.mock('../analyzer.js', () => ({ analyzeWorkContext: vi.fn(), analyzeUnderstandingSources: vi.fn(), workDiscoveryResultMarkdown: vi.fn() }));

const item: UnderstandingSourceItem = {
  id: 'note-1', sourceId: 'apple-notes', title: 'Writing preferences', text: 'Prefer concise replies.', type: 'note',
  ownerAttribution: 'user', sensitivity: 'normal', evidenceRef: 'apple-notes://note-1',
};

describe('manual source reanalysis', () => {
  let service: WorkDiscoveryService;
  beforeEach(() => {
    vi.clearAllMocks();
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
    service = new WorkDiscoveryService({ projects: new ProjectService(), sessions: {} as never,
      getConfig: () => ConfigSchema.parse({}), emit: vi.fn() });
    vi.spyOn(service, 'getModelProcessingTarget').mockReturnValue({ provider: 'local', remoteModel: false });
    vi.mocked(analyzeUnderstandingSources).mockResolvedValue({ modelRef: 'test', profileCandidates: [], workThreadCandidates: [],
      sourceStatuses: [{ sourceId: 'apple-notes', status: 'completed' }] });
  });
  afterEach(async () => { await service.stop(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  function source() {
    return upsertUnderstandingSourceGrant({ sourceKey: 'understanding-source:apple-notes', adapterId: 'apple-notes',
      category: 'notes', platform: 'darwin', displayName: 'Notes', accessMode: 'once', retentionPolicy: 'derived_only',
      processingPolicy: 'remote_allowed', config: {} });
  }

  it('reanalyzes identical items without changing authorization when the configured model is local', async () => {
    const grant = source();
    for (let i = 0; i < 2; i++) {
      await service.importUnderstandingSources([item], grant.processingPolicy, undefined, undefined, undefined, { grantId: grant.id });
    }
    expect(analyzeUnderstandingSources).toHaveBeenCalledTimes(2);
    expect(getUnderstandingSourceGrant(grant.id)?.processingPolicy).toBe('remote_allowed');
  });

  it('discards analysis after authorization is revoked and never reactivates the source', async () => {
    const grant = source();
    const result = await vi.mocked(analyzeUnderstandingSources)({} as never);
    vi.mocked(analyzeUnderstandingSources).mockImplementation(async () => {
      revokeUnderstandingSourceGrant(grant.id);
      return result;
    });
    await expect(service.importUnderstandingSources([item], grant.processingPolicy, undefined, undefined, undefined,
      { grantId: grant.id })).rejects.toThrow('authorization changed');
    expect(getUnderstandingSourceGrant(grant.id)?.status).toBe('revoked');
    expect(listUserAssertions()).toEqual([]);
  });
});
