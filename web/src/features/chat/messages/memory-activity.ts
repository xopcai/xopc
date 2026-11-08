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

/** A success label requires a committed host receipt, never just a completed tool step. */
export function buildMemoryMutationView(block: ToolUseContent, zh: boolean): MemoryActivityView {
  if (block.status === 'running') return { title: zh ? '正在更新记忆' : 'Updating memory', purpose: '' };
  const parsed = asRecord(parseJson(block.result));
  let receipt = asRecord(parsed?.details) ?? parsed;
  if (!receipt?.status && Array.isArray(parsed?.content)) {
    for (const part of parsed.content) {
      const candidate = asRecord(parseJson(asRecord(part)?.text));
      if (candidate?.status) { receipt = candidate; break; }
    }
  }
  const committed = typeof receipt?.receiptId === 'string' && typeof receipt.committedAt === 'number';
  if (block.status === 'error' || !committed || !['saved', 'pending', 'forgotten'].includes(String(receipt?.status))) return {
    title: zh ? '记忆修改未确认保存' : 'Memory change not confirmed',
    purpose: zh ? '未收到成功回执，请重试或查看记忆。' : 'No successful receipt was received. Retry or check your memory.',
  };
  const scope = asRecord(receipt?.scope)?.type;
  const scopes: Record<string, string> = zh
    ? { global: '所有协作', agent: '当前助手', workspace: '当前工作区', project: '当前项目', session: '当前会话' }
    : { global: 'All work', agent: 'This assistant', workspace: 'This workspace', project: 'This project', session: 'This conversation' };
  if (receipt?.status === 'forgotten') return { title: zh ? '已忘记这条记忆' : 'Memory forgotten',
    purpose: zh ? '后续不再自动使用；原始对话和文件保留，已运行的上下文不受影响。' : 'Future automatic recall is stopped. Original sources and already running contexts are retained.' };
  if (receipt?.available === false) return { title: zh ? '这条记忆已不再可用' : 'This memory is no longer available', purpose: '' };
  const pending = receipt?.status === 'pending' || receipt?.usable !== true;
  return { title: pending ? (zh ? '已保存，暂不使用' : 'Saved, not yet in use')
    : receipt?.command === 'correct' ? (zh ? '已纠正记忆' : 'Memory corrected')
      : receipt?.command === 'scope' ? (zh ? '已调整记忆范围' : 'Memory scope updated') : (zh ? '已记住' : 'Memory saved'),
    purpose: `${scopes[String(scope)] ?? ''}${pending ? (zh ? ' · 请在记忆中查看确认状态。' : ' · Check its review status in Memory.') : (zh ? ' · 从下一轮按需使用。' : ' · Available when relevant from the next turn.')}` };
}
