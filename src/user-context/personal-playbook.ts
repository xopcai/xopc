import type { MemoryRecord } from '../agent/memory/types.js';

export const PERSONAL_PLAYBOOK_RULE_TAG = 'playbook:rule';
export const PERSONAL_PLAYBOOK_DISABLED_TAG = 'playbook:disabled';
export const PERSONAL_PLAYBOOK_ORDER_PREFIX = 'playbook:order:';

function order(record: MemoryRecord): number {
  const tag = record.tags?.find((value) => value.startsWith(PERSONAL_PLAYBOOK_ORDER_PREFIX));
  const parsed = tag ? Number.parseInt(tag.slice(PERSONAL_PLAYBOOK_ORDER_PREFIX.length), 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 1_000;
}

export function buildPersonalPlaybookPrompt(records: MemoryRecord[]): string {
  const rules = records
    .filter((record) => record.status === 'active')
    .filter((record) => record.tags?.includes(PERSONAL_PLAYBOOK_RULE_TAG))
    .filter((record) => !record.tags?.includes(PERSONAL_PLAYBOOK_DISABLED_TAG))
    .sort((left, right) => order(left) - order(right) || left.updatedAt.localeCompare(right.updatedAt));
  if (!rules.length) return '';
  return ['## Personal playbook', ...rules.map((record) => `- ${record.content}`)].join('\n');
}
