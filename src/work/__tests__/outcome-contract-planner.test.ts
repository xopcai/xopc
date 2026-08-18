import { describe, expect, it } from 'vitest';

import {
  assessOutcomeIntent,
  parseOutcomeContractResponse,
} from '../outcome-contract-planner.js';

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

describe('assessOutcomeIntent', () => {
  const contract = {
    objective: 'Ship the release safely',
    deliverables: ['Published release'],
    acceptanceCriteria: ['Production reports the new version'],
    constraints: [],
    approvalRequired: [],
    assumptions: [],
    risks: [],
  };

  it('starts immediately when no material approval is required', () => {
    expect(assessOutcomeIntent(contract)).toEqual({
      confidence: 0.95,
      canStartImmediately: true,
    });
  });

  it('collapses all material approvals into one blocking decision', () => {
    expect(assessOutcomeIntent({
      ...contract,
      approvalRequired: ['Publish to production', 'Charge the release budget'],
    })).toMatchObject({
      confidence: 0.75,
      canStartImmediately: false,
      blockingDecision: {
        id: 'approve-execution-boundaries',
        question: expect.stringContaining('Publish to production; Charge the release budget'),
      },
    });
  });
});
