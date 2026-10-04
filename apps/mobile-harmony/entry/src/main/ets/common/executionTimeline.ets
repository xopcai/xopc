import { XopcChatTool, XopcExecutionStep } from '../model/chat';

export interface XopcExecutionGroup {
  id: string;
  kind: string;
  category: string;
  status: string;
  steps: XopcExecutionStep[];
}

export function groupExecutionSteps(steps: XopcExecutionStep[], live: boolean): XopcExecutionGroup[] {
  const groups: XopcExecutionGroup[] = [];
  for (const step of steps) {
    if (step.kind === 'thinking') continue;
    const status = step.status === 'running' && !live ? 'stopped' : step.status || 'done';
    const category = step.category || 'other';
    const previous = groups[groups.length - 1];
    if (step.kind === 'tool' && previous?.kind === 'tool' && previous.category === category
      && previous.status === status && status !== 'error') {
      previous.steps.push(step);
    } else {
      groups.push({ id: step.id, kind: step.kind, category, status, steps: [step] });
    }
  }
  return groups;
}

function shortPublicText(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ').slice(0, 160);
  return /(?:api[_-]?key|password|secret|bearer\s|token[=:])/i.test(text) ? '' : text;
}

function safeUrl(value: string): string {
  const match = /^https?:\/\/[^/?#]+(?:\/[^?#]*)?/i.exec(value.trim());
  return match ? match[0].slice(0, 160) : '';
}

/** Only show bounded search terms and URL paths; command arguments and raw results stay hidden. */
export function executionStepPreview(step: XopcExecutionStep, calls: XopcChatTool[] = []): string {
  if (step.preview) return step.preview;
  const input = calls.find((call: XopcChatTool): boolean => call.id === step.id)?.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const args = input as Record<string, Object>;
  if (step.category === 'search') {
    if (typeof args['query'] === 'string') return shortPublicText(args['query'] as string);
    const searches = args['search_query'];
    if (Array.isArray(searches) && searches.length) {
      const first = searches[0] as Record<string, Object>;
      if (first && typeof first['q'] === 'string') return shortPublicText(first['q'] as string);
    }
  }
  if (step.category === 'fetch') {
    if (typeof args['url'] === 'string') return safeUrl(args['url'] as string);
    const opens = args['open'];
    if (Array.isArray(opens) && opens.length) {
      const first = opens[0] as Record<string, Object>;
      if (first && typeof first['ref_id'] === 'string') return safeUrl(first['ref_id'] as string);
    }
  }
  return '';
}
