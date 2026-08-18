import { describe, expect, it } from 'vitest';

import { parseOutcomeContractResponse } from '../outcome-contract-planner.js';

describe('parseOutcomeContractResponse', () => {
  it('keeps verifiable criteria, assumptions, and risks', () => {
    expect(parseOutcomeContractResponse(`\n\`\`\`json\n{
      "objective": "Ship the release safely",
      "deliverables": ["Published release", "Release notes"],
      "acceptanceCriteria": ["The production version reports 2.0.0", "The release smoke test passes"],
      "constraints": ["Do not expose credentials"],
      "approvalRequired": ["Publish to production"],
      "assumptions": ["The release branch is current"],
      "risks": ["Registry outage"]
    }\n\`\`\``)).toEqual({
      objective: 'Ship the release safely',
      deliverables: ['Published release', 'Release notes'],
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
    expect(parseOutcomeContractResponse('{"objective":"Ship","deliverables":["Release"]}')).toBeUndefined();
  });
});
