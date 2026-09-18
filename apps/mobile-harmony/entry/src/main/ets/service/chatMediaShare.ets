import { common } from '@kit.AbilityKit';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { util } from '@kit.ArkTS';
import { systemShare } from '@kit.ShareKit';
import { XopcHistoryMedia } from '../model/chat';
import { readChatMedia } from './chatMedia';
import { gatewaySession } from './gatewaySession';

let sharing: boolean = false;

// Keep handed-off files after panel dismissal: receivers may read their URI later.
// Subsequent shares prune files older than one day; size/count caps also apply.
export async function shareChatMedia(context: common.UIAbilityContext, file: XopcHistoryMedia, conversationId: string): Promise<void> {
  if (sharing) throw new Error('SHARE_BUSY');
  sharing = true;
  let path = '';
  try {
    const revision = gatewaySession.connectionRevision();
    const bytes = await readChatMedia(file, conversationId);
    gatewaySession.assertConnection(revision);
    const directory = context.cacheDir + '/chat-shares';
    if (!await fs.access(directory)) await fs.mkdir(directory);
    let retainedSize = 0; let retainedCount = 0;
    for (const name of await fs.listFile(directory)) {
      if (!/^[0-9a-f-]{36}_/.test(name) || name.includes('/')) continue;
      const existing = directory + '/' + name;
      const info = await fs.stat(existing);
      if (!info.isFile()) continue;
      if (Date.now() - info.mtime * 1000 > 86400000) await fs.unlink(existing);
      else { retainedSize += info.size; retainedCount++; }
    }
    if (retainedCount >= 32 || retainedSize + bytes.byteLength > 64 * 1024 * 1024) throw new Error('SHARE_CACHE_FULL');
    const name = (file.name || 'attachment').replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(-100);
    path = directory + '/' + util.generateRandomUUID() + '_' + name;
    const output = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
    try { if (await fs.write(output.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_MEDIA'); }
    finally { await fs.close(output); }
    gatewaySession.assertConnection(revision);
    let type = utd.UniformDataType.FILE as string;
    try { type = utd.getUniformDataTypeByMIMEType(file.mimeType, utd.UniformDataType.FILE); } catch (_) {}
    const data = new systemShare.SharedData({ utd: type, uri: fileUri.getUriFromPath(path), title: file.name || 'attachment' });
    await new systemShare.ShareController(data).show(context, { selectionMode: systemShare.SelectionMode.SINGLE, previewMode: systemShare.SharePreviewMode.DEFAULT });
    path = '';
  } finally {
    if (path) { try { await fs.unlink(path); } catch (_) {} }
    sharing = false;
  }
}
