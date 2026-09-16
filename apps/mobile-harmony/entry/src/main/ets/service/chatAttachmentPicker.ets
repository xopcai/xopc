import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker, fileUri } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { XopcChatAttachment } from '../model/chat';
import { attachmentMime, validateAttachmentSize } from '../common/attachments';

export async function pickChatAttachment(context: common.Context, current: XopcChatAttachment[]): Promise<XopcChatAttachment | undefined> {
  const options = new picker.DocumentSelectOptions(); options.maxSelectNumber = 1;
  const uris = await new picker.DocumentViewPicker(context).select(options);
  if (!uris.length) return undefined;
  const uri = uris[0]; const name = new fileUri.FileUri(uri).name;
  const file = await fs.open(uri, fs.OpenMode.READ_ONLY);
  try {
    const size = (await fs.stat(file.fd)).size;
    validateAttachmentSize(size, current);
    const data = new ArrayBuffer(size);
    if (await fs.read(file.fd, data) !== size) throw new Error('INCOMPLETE_FILE_READ');
    const mimeType = attachmentMime(name);
    return { type: mimeType.startsWith('image/') ? 'image' : 'document', name, mimeType, size,
      data: await new util.Base64Helper().encodeToString(new Uint8Array(data)) };
  } finally { await fs.close(file); }
}
