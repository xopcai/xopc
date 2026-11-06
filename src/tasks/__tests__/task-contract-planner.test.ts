import { describe, expect, it } from 'vitest';

import {
  parseTaskContractResponse,
} from '../task-contract-planner.js';

describe('parseTaskContractResponse', () => {
  it('keeps verifiable criteria, assumptions, and risks', () => {
    expect(parseTaskContractResponse(`\n\`\`\`json\n{
      "objective": "Ship the release safely",
      "expectedOutputs": ["Published release", "Release notes"],
      "acceptanceCriteria": ["The production version reports 2.0.0", "The release smoke test passes"],
      "constraints": ["Do not expose credentials"],
      "approvalRequired": ["Publish to production"],
      "assumptions": ["The release branch is current"],
      "risks": ["Registry outage"]
    }\n\`\`\``)).toEqual({
      objective: 'Ship the release safely',
      expectedOutputs: ['Published release', 'Release notes'],
      acceptanceCriteria: [
        'The production version reports 2.0.0',
        'The release smoke test passes',
      ],
      constraints: ['Do not expose credentials'],
      approvalRequired: ['Publish to production'],
      assumptions: ['The release branch is current'],
      risks: ['Registry outage'],
    });
  });

  it('preserves an explicit human acceptance policy while keeping automatic acceptance as the default', () => {
    const base = { objective: 'Deliver files', expectedOutputs: ['report.md'], acceptanceCriteria: ['Report bytes verified'] };
    expect(parseTaskContractResponse(JSON.stringify({ ...base, acceptancePolicy: 'manual' }))?.acceptancePolicy).toBe('manual');
    expect(parseTaskContractResponse(JSON.stringify({ ...base, acceptancePolicy: 'verified_auto' }))?.acceptancePolicy).toBe('verified_auto');
    expect(parseTaskContractResponse(JSON.stringify({ ...base, acceptancePolicy: 'unknown' }))).toBeUndefined();
  });

  it('rejects nested result objects and unknown operation names instead of dropping requirements', () => {
    const base = { objective: 'Deliver files', expectedOutputs: ['report.md'], acceptanceCriteria: ['Report bytes verified'] };
    expect(parseTaskContractResponse(JSON.stringify({ ...base, expectedOutputs: [{ path: 'report.md' }] }))).toBeUndefined();
    expect(parseTaskContractResponse(JSON.stringify({ ...base, acceptanceCriteria: [{ criterion: 'Report verified' }] }))).toBeUndefined();
    expect(parseTaskContractResponse(JSON.stringify({ ...base, requiredCapabilities: ['invented_operation'] }))).toBeUndefined();
    expect(parseTaskContractResponse(JSON.stringify({ ...base, requiredCapabilities: ['execute_code', 'publish_files'] }))?.requiredCapabilities)
      .toEqual(['execute_code', 'publish_files']);
  });
  it('keeps executable checks while moving delivery-message wording into constraints', () => {
    const planned = parseTaskContractResponse(JSON.stringify({ objective: 'Deliver', expectedOutputs: ['report.md'],
      acceptanceCriteria: ['已运行 node reproduce.mjs，且交付说明中包含该检查脚本的运行结果。', '交付说明仅说明交付情况，未复述附录核对码。'] }))!;
    expect(planned.acceptanceCriteria).toEqual(['已运行 node reproduce.mjs']);
    expect(planned.constraints).toHaveLength(2);
  });
  it('keeps the actual chat deliverable and its length and content requirements in acceptance', () => {
    const criteria = ['最终回复为中文，全文不超过 700 字', '最终回复区分正式发布和传闻'];
    expect(parseTaskContractResponse(JSON.stringify({ objective: '汇总发布情况', expectedOutputs: ['聊天回复'],
      acceptanceCriteria: criteria }))).toMatchObject({ acceptanceCriteria: criteria, constraints: [] });
    expect(parseTaskContractResponse(JSON.stringify({ objective: 'Return findings', expectedOutputs: ['Findings'],
      acceptanceCriteria: ['Final reply has at most 700 characters'] }))).toMatchObject({
      acceptanceCriteria: ['Final reply has at most 700 characters'],
    });
  });
  it('rejects contracts without checkable criteria', () => {
    expect(parseTaskContractResponse('{"objective":"Ship","expectedOutputs":["Release"]}')).toBeUndefined();
  });
  it('retains write prohibitions as constraints rather than unverifiable global-absence criteria', () => {
    const contract = parseTaskContractResponse(JSON.stringify({ objective: 'Analyze CSV', expectedOutputs: ['report.md'],
      acceptanceCriteria: ['report.md states monthly totals', '仅写入指定目录，未覆盖其他文件', '最终回复仅说明交付情况，不复述附录核对码。'],
      constraints: ['Do not change credentials'] }))!;
    expect(contract.acceptanceCriteria).toEqual(['report.md states monthly totals']);
    expect(contract.constraints).toEqual(['Do not change credentials', '仅写入指定目录，未覆盖其他文件', '最终回复仅说明交付情况，不复述附录核对码。']);
  });
});
