import type { ToolUseContent } from '@/features/chat/messages/messages.types';

export type MemoryActivityLabels = {
  running: string;
  found_one: string;
  found_other: string;
  empty: string;
  failed: string;
  purpose: string;
  why: string;
  explanation: string;
  manage: string;
  privacy: string;
};

export type MemoryActivityView = {
  title: string;
  purpose: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function resultRecords(result: unknown): Array<Record<string, unknown>> {
  const parsed = asRecord(parseJson(result));
  if (!parsed) return [];
  const details = asRecord(parsed.details);
  const direct = details?.results ?? parsed.results;
  if (Array.isArray(direct)) return direct.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);

  const content = Array.isArray(parsed.content) ? parsed.content : [];
  for (const item of content) {
    const text = asRecord(item)?.text;
    const nested = asRecord(parseJson(text));
    if (Array.isArray(nested?.results)) {
      return nested.results.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null);
    }
  }
  return [];
}

function fillCount(template: string, count: number): string {
  return template.replace(/\{\{count\}\}/g, String(count));
}

export function buildMemoryActivityView(
  block: ToolUseContent,
  labels: MemoryActivityLabels,
): MemoryActivityView {
  if (block.status === 'running' || block.activity?.status === 'running') {
    return { title: labels.running, purpose: labels.purpose };
  }
  if (block.status === 'error' || block.activity?.status === 'failed') {
    return { title: labels.failed, purpose: labels.purpose };
  }

  const records = resultRecords(block.result);
  const count = block.activity?.count ?? records.length;
  const title = count === 0
    ? labels.empty
    : fillCount(count === 1 ? labels.found_one : labels.found_other, count);
  return { title, purpose: labels.purpose };
}
