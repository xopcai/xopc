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
});
