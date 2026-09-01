import { collectClipboardFiles, isComposerAcceptableFile } from '@/features/chat/composer/composer-clipboard';
import { classifyPastedText, type PastedTextAttachment } from '@/features/chat/composer/pasted-text';

export type ComposerPasteAction =
  | { kind: 'files'; files: File[] }
  | { kind: 'unsupported-files' }
  | { kind: 'text-attachment'; attachment: PastedTextAttachment }
  | { kind: 'inline-text'; text: string };

export function resolveComposerPaste(data: DataTransfer | null): ComposerPasteAction | null {
  if (!data) return null;

  const files = collectClipboardFiles(data);
  const acceptedFiles = files.filter(isComposerAcceptableFile);
  if (acceptedFiles.length > 0) return { kind: 'files', files: acceptedFiles };
  if (files.length > 0) return { kind: 'unsupported-files' };

  const text = data.getData('text/plain');
  if (!text) return null;

  const attachment = classifyPastedText(text);
  return attachment
    ? { kind: 'text-attachment', attachment }
    : { kind: 'inline-text', text };
}

export async function applyComposerPaste(
  action: ComposerPasteAction,
  handlers: {
    processFiles: (files: File[]) => Promise<void>;
    processPastedText: (paste: PastedTextAttachment) => Promise<void>;
    insertText: (text: string) => void;
    onUnsupportedFiles: () => void;
  },
): Promise<void> {
  switch (action.kind) {
    case 'files':
      await handlers.processFiles(action.files);
      return;
    case 'unsupported-files':
      handlers.onUnsupportedFiles();
      return;
    case 'text-attachment':
      await handlers.processPastedText(action.attachment);
      return;
    case 'inline-text':
      handlers.insertText(action.text);
  }
}
