export interface OutcomeContractDefinition {
  objective: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  approvalRequired: string[];
}

export function defineOutcomeContract(objectiveInput: string): OutcomeContractDefinition {
  const objective = objectiveInput.trim();
  if (!objective) throw new Error('Objective is required');
  const chinese = /[\u3400-\u9fff]/u.test(objective);
  return {
    objective,
    deliverables: [objective],
    acceptanceCriteria: chinese
      ? [`已交付：${objective}`, '结果有可检查的证据，并满足用户明确提出的约束。']
      : [`Delivered: ${objective}`, 'The result has inspectable evidence and satisfies the user-provided constraints.'],
    constraints: [],
    approvalRequired: [],
  };
}
