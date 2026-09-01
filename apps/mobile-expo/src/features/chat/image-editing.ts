import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';

import type { ComposerAttachment } from './composer.types';
import type { CropRect } from './image-editor-math';

const EDITED_IMAGE_QUALITY = 0.92;

function outputFormat(mimeType: string): { format: SaveFormat; mimeType: string; extension: string } {
  if (mimeType === 'image/png') {
    return { format: SaveFormat.PNG, mimeType: 'image/png', extension: 'png' };
  }
  if (mimeType === 'image/webp') {
    return { format: SaveFormat.WEBP, mimeType: 'image/webp', extension: 'webp' };
  }
  return { format: SaveFormat.JPEG, mimeType: 'image/jpeg', extension: 'jpg' };
}

function editedFileName(name: string, extension: string): string {
  const stem = name.replace(/\.[^./]+$/, '') || 'image';
  return `${stem}.${extension}`;
}

function base64ByteLength(base64: string): number {
  const compact = base64.replace(/\s/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

async function saveRenderedImage(
  sourceUri: string,
  mimeType: string,
  transform: (context: ReturnType<typeof ImageManipulator.manipulate>) => void,
  base64: boolean,
): Promise<ImageResult> {
  const output = outputFormat(mimeType);
  const context = ImageManipulator.manipulate(sourceUri);
  transform(context);
  const rendered = await context.renderAsync();
  return rendered.saveAsync({
    base64,
    compress: EDITED_IMAGE_QUALITY,
    format: output.format,
  });
}

export function rotateImageForEditing(sourceUri: string, mimeType: string, degrees: number): Promise<ImageResult> {
  return saveRenderedImage(sourceUri, mimeType, (context) => context.rotate(degrees), false);
}

export async function cropImageAttachment(
  attachment: ComposerAttachment,
  sourceUri: string,
  crop: CropRect,
  rotation: number,
): Promise<ComposerAttachment> {
  const output = outputFormat(attachment.mimeType);
  const result = await saveRenderedImage(sourceUri, attachment.mimeType, (context) => {
    if (rotation) context.rotate(rotation);
    context.crop(crop);
  }, true);
  const content = result.base64?.replace(/\s/g, '');
  if (!content) throw new Error('Edited image data is unavailable');
  return {
    id: attachment.id,
    type: 'image',
    name: editedFileName(attachment.name, output.extension),
    mimeType: output.mimeType,
    size: base64ByteLength(content),
    content,
    localUri: result.uri,
  };
}
