import type { ImageContent, MessageAttachment } from '@/features/chat/messages/messages.types';

export function imageBlockToMessageAttachment(block: ImageContent, index: number): MessageAttachment | null {
  const raw = block.source?.data?.trim();
  if (!raw) return null;
  const match = raw.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (match?.[1] && match[2]) {
    const data = match[2].replace(/\s/g, '');
    return {
      name: `image-${index + 1}`,
      mimeType: match[1],
      type: 'image',
      content: data,
      data,
    };
  }
  if (raw.startsWith('data:')) {
    return {
      name: `image-${index + 1}`,
      mimeType: 'image/png',
      type: 'image',
      content: raw,
      data: raw,
    };
  }
  const data = raw.replace(/\s/g, '');
  return {
    name: `image-${index + 1}`,
    mimeType: 'image/png',
    type: 'image',
    content: data,
    data,
  };
}

export function imageContentBlocksToAttachments(blocks: ImageContent[] | undefined): MessageAttachment[] {
  if (!blocks?.length) return [];
  return blocks.flatMap((block, index) => {
    const attachment = imageBlockToMessageAttachment(block, index);
    return attachment ? [attachment] : [];
  });
}
