import type { ExecutionCapability } from './task-execution-capabilities.js';

export interface TaskContractDefinition {
  acceptancePolicy?: 'verified_auto' | 'manual';
  objective: string;
  expectedOutputs: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  approvalRequired: string[];
  assumptions: string[];
  risks: string[];
  requiredCapabilities?: ExecutionCapability[];
  capabilityPlanning?: 'complete' | 'unavailable';
}

export function defineTaskContract(objectiveInput: string, locale?: 'en' | 'zh'): TaskContractDefinition {
  const objective = objectiveInput.trim();
  if (!objective) throw new Error('Objective is required');
  const chinese = locale ? locale === 'zh' : /[\u3400-\u9fff]/u.test(objective);
  return {
    objective,
    expectedOutputs: [objective],
    acceptanceCriteria: chinese
      ? [`已交付：${objective}`, '结果有可检查的证据，并满足用户明确提出的约束。']
      : [`Delivered: ${objective}`, 'The result has inspectable evidence and satisfies the user-provided constraints.'],
    constraints: [],
    approvalRequired: [],
    assumptions: [],
    risks: [],
  };
}

/**
 * Returns true when a task uses the default lightweight contract (including warm follow-ups)
 * rather than custom caller-specified acceptance criteria or high-risk approval gates.
 */
export function isLightweightDefaultContract(contract: {
  objective: string;
  expectedOutputs: readonly string[];
  acceptanceCriteria: readonly string[];
  approvalRequired?: readonly string[];
  risks?: readonly string[];
} | undefined): boolean {
  if (!contract) return false;
  if ((contract.approvalRequired?.length ?? 0) > 0 || (contract.risks?.length ?? 0) > 0) return false;
  if (contract.acceptanceCriteria.length === 0) return true;
  const baseObjective = contract.objective.split(/\n(?:Current revision|Follow-up):/)[0]?.trim() ?? contract.objective.trim();
  if (!baseObjective) return false;
  for (const locale of ['zh', 'en'] as const) {
    for (const candidate of [contract.objective.trim(), baseObjective]) {
      const def = defineTaskContract(candidate, locale);
      if (JSON.stringify(contract.acceptanceCriteria) === JSON.stringify(def.acceptanceCriteria)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Zero-LLM fast capability inference for lightweight task allocation.
 * Infers only concrete tool-family requirements implied by explicit file extensions or media targets.
 */
export function inferFastTaskCapabilities(input: {
  objective: string;
  body?: string;
  sourceIds?: readonly string[];
  expectedOutputs?: readonly string[];
}): ExecutionCapability[] {
  const capabilities = new Set<ExecutionCapability>();
  const combined = [input.objective, input.body ?? '', ...(input.sourceIds ?? []), ...(input.expectedOutputs ?? [])].join('\n');
  if ((input.sourceIds?.length ?? 0) > 0 || /\bmedia:\/\/|\.(?:csv|tsv|json|md|txt|log|ya?ml|xml|html)\b/i.test(combined)) {
    capabilities.add('read_input');
  }
  if (/\.(?:pdf|docx|pptx|xlsx|xls|parquet|sqlite|db|zip)\b/i.test(combined)) {
    capabilities.add('read_input');
    capabilities.add('execute_code');
  }
  if (/\.(?:pdf|docx|pptx|xlsx|csv|png|jpg|jpeg|svg|html|zip)\b/i.test((input.expectedOutputs ?? []).join(' '))) {
    capabilities.add('publish_files');
  }
  if (/(?:生成|绘制|画一[张幅]|设计一[张幅])\s*(?:图片|海报|插画|配图|封面|logo)|\b(?:generate|create|draw)\s+(?:an?\s+)?(?:image|illustration|poster|banner)\b/i.test(input.objective)) {
    capabilities.add('generate_image');
  }
  return [...capabilities];
}
