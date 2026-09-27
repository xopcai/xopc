import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { WireAttachment } from './composer.types';
import type { ComposerAttachment } from './composer.types';
import { getStorageKeys, storage } from '../../storage/mmkv';

const draftCopies = new Map<string, string>();
let lastCollectionAt = 0;

export function persistComposerAttachments(attachments: ComposerAttachment[]): ComposerAttachment[] {
  const root = new Directory(Paths.document, 'chat-drafts');
  const prefix = root.uri.replace(/\/+$/, '') + '/';
  return attachments.map(attachment => {
    if (attachment.uri || attachment.workspaceRelativePath) return { ...attachment, content: '' };
    if (attachment.localUri?.startsWith(prefix)) return { ...attachment, content: '' };
    if (!attachment.localUri && !attachment.content) return attachment;
    const sourceKey = JSON.stringify([attachment.id, attachment.localUri ?? 'inline']);
    let uri = draftCopies.get(sourceKey);
    if (!uri || !new File(uri).exists) {
      const directory = new Directory(root, randomUUID());
      directory.create({ intermediates: true, idempotent: true });
      const file = new File(directory, 'payload');
      if (attachment.localUri) new File(attachment.localUri).copy(file);
      else file.write(attachment.content, { encoding: 'base64' });
      uri = file.uri;
      draftCopies.set(sourceKey, uri);
    }
    return { ...attachment, localUri: uri, content: '' };
  });
}

/** Only unreferenced app-owned payloads older than a day may be reclaimed. */
export function collectUnusedChatAttachments(now = Date.now()): void {
  if (now - lastCollectionAt < 60_000) return;
  lastCollectionAt = now;
  try {
    const records = getStorageKeys().map(key => storage.getString(key) ?? '');
    for (const name of ['chat-drafts', 'chat-outbox']) {
      const root = new Directory(Paths.document, name);
      if (!root.exists) continue;
      for (const directory of root.list()) {
        if (!(directory instanceof Directory) || !/^[0-9a-f-]{36}$/i.test(directory.name)) continue;
        const contents = directory.list();
        if (contents.length !== 1 || !(contents[0] instanceof File) || contents[0].name !== 'payload') continue;
        const file = contents[0];
        const modified = file.modificationTime;
        if (!modified || now - modified < 86_400_000 || records.some(raw => raw.includes(file.uri))) continue;
        directory.delete();
        for (const [key, uri] of draftCopies) if (uri === file.uri) draftCopies.delete(key);
      }
    }
  } catch {
    // Cleanup is best effort; a failed scan must never interrupt draft saving.
  }
}

/** Copy transient picker/recorder files before a submission becomes durable. */
export async function persistSubmissionAttachments(attachments: WireAttachment[]): Promise<WireAttachment[]> {
  const root = new Directory(Paths.document, 'chat-outbox');
  const prefix = root.uri.replace(/\/+$/, '') + '/';
  return Promise.all(attachments.map(async attachment => {
    if (!attachment.localUri || attachment.uri || attachment.workspaceRelativePath
      || attachment.localUri.startsWith(prefix)) return attachment;
    const directory = new Directory(root, randomUUID());
    directory.create({ intermediates: true, idempotent: true });
    const target = new File(directory, 'payload');
    await new File(attachment.localUri).copy(target);
    return { ...attachment, localUri: target.uri };
  }));
}
