import { describe, expect, it } from 'vitest';

import { buildPersonalTaskBrief } from '../personal-task-tool.js';

describe('personal task brief', () => {
  it('keeps the title short while preserving a long delegation brief for the worker', () => {
    const requirement = '核实证券名称、上市主体与交易数据，并分析财报、估值、竞争格局和主要风险。'.repeat(8);
    const brief = buildPersonalTaskBrief({
      objective: `调研 MiniMax 的投资价值。${requirement}`,
      description: '## 交付物\n\n给出有条件的价值判断。',
    });

    expect(brief.title).toBe('调研 MiniMax 的投资价值');
    expect(brief.objective).toBe(brief.title);
    expect(brief.body).toContain(requirement);
    expect(brief.body).toContain('## 交付物');
  });
});
