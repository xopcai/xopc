import { Directory, File, Paths } from 'expo-file-system';
import type { WireAttachment } from '../chat/composer.types';

/** Own pending files in Documents so OS cache eviction cannot remove an unsent attachment. */
export function retainOutboxAttachments(id: string, attachments: WireAttachment[]): WireAttachment[] {
  const directory = new Directory(Paths.document, 'pending-inputs', id);
  return attachments.map((attachment, index) => {
    const uri = attachment.localUri ?? attachment.uri;
    if (!uri || !/^(file|content):\/\//i.test(uri)) return attachment;
    directory.create({ intermediates: true, idempotent: true });
    const source = new File(uri);
    const file = new File(directory, `${index}.${(attachment.name?.split('.').pop() ?? 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`);
    if (source.uri !== file.uri && !file.exists) source.copy(file);
    if (!file.exists || file.size <= 0) throw new Error('Attachment is unavailable');
    return { ...attachment, data: undefined, uri: undefined, localUri: file.uri };
  });
}
export function releaseOutboxAttachments(id: string): void {
  try { const dir = new Directory(Paths.document, 'pending-inputs', id); if (dir.exists) dir.delete(); } catch { /* Cleanup can be retried later. */ }
}
