import type { ComposerAttachment } from './composer.types';
import { mimeTypeFromFileName } from './tool-result-file-paths';

export type AttachmentPickSource = 'camera' | 'photos' | 'document';

export function shouldOpenNativeImageEditor(source: AttachmentPickSource): boolean {
  return source === 'camera' || source === 'photos';
}

export function attachmentTypeFromMime(mimeType: string): 'image' | 'document' | 'audio' {
  if (mimeType.startsWith('audio/')) return 'audio';
  return mimeType.startsWith('image/') ? 'image' : 'document';
}

export function newAttachmentId(name: string): string {
  return `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function composerAttachmentFromBase64(params: {
  uri: string;
  name: string;
  mimeType: string;
  content: string;
  size: number;
}): ComposerAttachment {
  const mimeType = params.mimeType || mimeTypeFromFileName(params.name);
  return {
    id: newAttachmentId(params.name),
    type: attachmentTypeFromMime(mimeType),
    name: params.name,
    mimeType,
    size: params.size,
    content: params.content.replace(/\s/g, ''),
    localUri: params.uri,
  };
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Encode binary without relying on `expo-file-system` (avoids native module mismatch on Android). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}
