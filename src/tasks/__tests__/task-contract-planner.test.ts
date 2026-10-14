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

  it('rejects contracts without checkable criteria', () => {
    expect(parseTaskContractResponse('{"objective":"Ship","expectedOutputs":["Release"]}')).toBeUndefined();
  });
  it('retains write prohibitions as constraints rather than unverifiable global-absence criteria', () => {
    const contract = parseTaskContractResponse(JSON.stringify({ objective: 'Analyze CSV', expectedOutputs: ['report.md'],
      acceptanceCriteria: ['report.md states monthly totals', '仅写入指定目录，未覆盖其他文件'],
      constraints: ['Do not change credentials'] }))!;
    expect(contract.acceptanceCriteria).toEqual(['report.md states monthly totals']);
    expect(contract.constraints).toEqual(['Do not change credentials', '仅写入指定目录，未覆盖其他文件']);
  });
});
