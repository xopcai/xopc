import type { XopcHistory, XopcChatRow, XopcContentBlock } from '../model/chat';

export function historyRows(history: XopcHistory, page: string = 'latest'): XopcChatRow[] {
  if (!history.session || !Array.isArray(history.session.messages) || !history.pagination) throw new Error('INVALID_HISTORY');
  const rows: XopcChatRow[] = [];
  history.session.messages.forEach((message, index: number): void => {
    let text: string = '';
    if (typeof message.content === 'string') text = message.content;
    else if (Array.isArray(message.content)) text = message.content.map((block: XopcContentBlock): string => {
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'thinking') return block.thinking ?? '';
      if (block.type === 'toolCall') return '[' + (block.name ?? 'tool') + ']';
      return '[' + block.type + ']';
    }).join('\n');
    if (Array.isArray(message.media)) {
      text += message.media.map((file): string => '\n[' + file.name + ']').join('');
    }
    if (text) rows.push({ id: message.id ?? page + ':' + index, role: message.role, text });
  });
  return rows;
}
