import { XopcChatBlock, XopcChatRow, XopcProductDelivery } from '../model/chat';
import { chatAnswerText, chatDeliveries } from './chatRichContent';

export const CHAT_MESSAGE_MAX_WIDTH = '84%';

export function chatTextBubbleWidth(text: string, minimum: number): string {
  let lineUnits = 0;
  let widestLineUnits = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      widestLineUnits = Math.max(widestLineUnits, lineUnits);
      lineUnits = 0;
    } else if (code !== 13) {
      lineUnits += code > 255 ? 1 : 0.55;
    }
  }
  widestLineUnits = Math.max(widestLineUnits, lineUnits);
  return Math.max(minimum, Math.min(360, Math.ceil(widestLineUnits * 16) + 30)) + 'vp';
}

export function chatPlainAssistantBubbleText(row: XopcChatRow): string {
  if (row.media?.length || row.refs?.length || row.outcome?.deliverables.length || row.outcome?.status === 'failed'
    || row.deliveries?.some((delivery: XopcProductDelivery): boolean => !!delivery.projectComparison)
    || (!row.live && chatDeliveries(row).length) || row.blocks?.some((block: XopcChatBlock): boolean => block.kind === 'review')) return '';
  const text = chatAnswerText(row);
  return /[\r\n#`*_~[\]<>|$\\]|^(?:[-+]\s|\d+[.)]\s)/.test(text) ? '' : text;
}
