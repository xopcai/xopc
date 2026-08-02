import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../../agent/memory/types.js';
import { buildPersonalPlaybookPrompt } from '../personal-playbook.js';

function rule(id: string, content: string, tags: string[]): MemoryRecord {
  return {
    id,
    kind: 'task_lesson',
    status: 'active',
    scope: {},
    provenance: {},
    content,
    source: { provider: 'local' },
    sensitivity: 'normal',
    explicitness: 'explicit',
    durability: 'durable',
    importance: 1,
    disclosurePolicy: 'referenceable',
    evidence: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tags,
  };
}

describe('personal playbook prompt', () => {
  it('injects only approved and enabled rules in explicit order', () => {
    const prompt = buildPersonalPlaybookPrompt([
      rule('disabled', 'Never shown', ['playbook:rule', 'playbook:disabled']),
      rule('unapproved', 'Also never shown', []),
      rule('second', 'Run tests', ['playbook:rule', 'playbook:order:20']),
      rule('first', 'Lead with the result', ['playbook:rule', 'playbook:order:10']),
    ]);
    expect(prompt).toContain('Lead with the result\n- Run tests');
    expect(prompt).not.toContain('Never shown');
    expect(prompt).not.toContain('Also never shown');
  });
});
