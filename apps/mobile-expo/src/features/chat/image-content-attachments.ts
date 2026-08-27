import type { ImageContent, MessageAttachment } from './messages.types';
import { normalizeGeneratedWorkspacePath } from './image-source-utils';
import { isMediaUri } from './media-uri';

export function imageBlockToMessageAttachment(
  block: ImageContent,
  index: number,
): MessageAttachment | null {
  const raw = block.source?.data?.trim();
  if (!raw) return null;

  const dataUrl = raw.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (dataUrl?.[1] && dataUrl[2]) {
    const data = dataUrl[2].replace(/\s/g, '');
    return {
      name: `image-${index + 1}`,
      mimeType: dataUrl[1],
      type: 'image',
      content: data,
      data,
    };
  }
  if (raw.startsWith('data:')) {
    return {
      name: `image-${index + 1}`,
      mimeType: block.source?.media_type || 'image/png',
      type: 'image',
      content: raw,
      data: raw,
    };
  }
  if (isMediaUri(raw)) {
    return {
      name: `image-${index + 1}`,
      mimeType: block.source?.media_type || 'image/png',
      type: 'image',
      uri: raw,
    };
  }

  const generatedPath = normalizeGeneratedWorkspacePath(raw);
  if (generatedPath) {
    return {
      name: generatedPath.split('/').filter(Boolean).pop() || `image-${index + 1}`,
      mimeType: block.source?.media_type || 'image/png',
      type: 'image',
      workspaceRelativePath: generatedPath,
    };
  }

  const data = raw.replace(/\s/g, '');
  return {
    name: `image-${index + 1}`,
    mimeType: block.source?.media_type || 'image/png',
    type: 'image',
    content: data,
    data,
  };
}

export function imageContentBlocksToAttachments(
  blocks: ImageContent[] | undefined,
): MessageAttachment[] {
  if (!blocks?.length) return [];
  return blocks.flatMap((block, index) => {
    const attachment = imageBlockToMessageAttachment(block, index);
    return attachment ? [attachment] : [];
  });
}
