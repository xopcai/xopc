import type { MemoryRecord } from '../agent/memory/types.js';

export const PERSONAL_PLAYBOOK_RULE_TAG = 'playbook:rule';
export const PERSONAL_PLAYBOOK_DISABLED_TAG = 'playbook:disabled';
export const PERSONAL_PLAYBOOK_ORDER_PREFIX = 'playbook:order:';
const PLAYBOOK_CHANNEL_PREFIX = 'playbook:when:channel:';
const PLAYBOOK_SUPPORT_PREFIX = 'playbook:when:support:';

export interface PersonalPlaybookContext {
  channel?: string;
  supportNeed?: 'listen' | 'clarify' | 'advise' | 'act' | 'unknown';
}

export function personalPlaybookContext(record: MemoryRecord): PersonalPlaybookContext {
  const channel = record.tags?.find((tag) => tag.startsWith(PLAYBOOK_CHANNEL_PREFIX))?.slice(PLAYBOOK_CHANNEL_PREFIX.length);
  const supportNeed = record.tags?.find((tag) => tag.startsWith(PLAYBOOK_SUPPORT_PREFIX))?.slice(PLAYBOOK_SUPPORT_PREFIX.length);
  return {
    ...(channel ? { channel: decodeURIComponent(channel) } : {}),
    ...(supportNeed ? { supportNeed: supportNeed as PersonalPlaybookContext['supportNeed'] } : {}),
  };
}

export function patchPersonalPlaybookContextTags(
  tags: string[],
  patch: PersonalPlaybookContext,
): string[] {
  let next = tags;
  if ('channel' in patch) {
    next = next.filter((tag) => !tag.startsWith(PLAYBOOK_CHANNEL_PREFIX));
    if (patch.channel) next.push(`${PLAYBOOK_CHANNEL_PREFIX}${encodeURIComponent(patch.channel)}`);
  }
  if ('supportNeed' in patch) {
    next = next.filter((tag) => !tag.startsWith(PLAYBOOK_SUPPORT_PREFIX));
    if (patch.supportNeed) next.push(`${PLAYBOOK_SUPPORT_PREFIX}${patch.supportNeed}`);
  }
  return [...new Set(next)];
}

function order(record: MemoryRecord): number {
  const tag = record.tags?.find((value) => value.startsWith(PERSONAL_PLAYBOOK_ORDER_PREFIX));
  const parsed = tag ? Number.parseInt(tag.slice(PERSONAL_PLAYBOOK_ORDER_PREFIX.length), 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 1_000;
}

export function buildPersonalPlaybookPrompt(
  records: MemoryRecord[],
  context: PersonalPlaybookContext = {},
): string {
  const rules = records
    .filter((record) => record.status === 'active')
    .filter((record) => record.tags?.includes(PERSONAL_PLAYBOOK_RULE_TAG))
    .filter((record) => !record.tags?.includes(PERSONAL_PLAYBOOK_DISABLED_TAG))
    .filter((record) => {
      const condition = personalPlaybookContext(record);
      return (!condition.channel || condition.channel === context.channel)
        && (!condition.supportNeed || condition.supportNeed === context.supportNeed);
    })
    .sort((left, right) => order(left) - order(right) || left.updatedAt.localeCompare(right.updatedAt));
  if (!rules.length) return '';
  return ['## Personal playbook', ...rules.map((record) => `- ${record.content}`)].join('\n');
}
