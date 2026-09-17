import { pasteboard } from '@kit.BasicServicesKit';
import { gatewaySession } from './gatewaySession';
import { XopcNoteResult } from '../model/workspace';

interface XopcMessageNote { text: string; channel: string; platform: string; }

export async function copyChatMessage(text: string): Promise<void> {
  await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text));
}

export async function saveChatMessage(text: string): Promise<void> {
  if (!text.trim()) return;
  const body: XopcMessageNote = { text, channel: 'app', platform: 'harmonyos' };
  const result = JSON.parse(await gatewaySession.request('/api/notes/quick-capture', 'POST', JSON.stringify(body))) as XopcNoteResult;
  if (!result.note?.id) throw new Error('INVALID_CAPTURE_RESPONSE');
}
