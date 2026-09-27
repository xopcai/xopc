import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { XopcChatAttachment } from '../model/chat';
import { centeredImageCrop, imageEditAspect, XopcImageSize } from '../common/chatImageEditing';

interface XopcImageOutput { mimeType: string; extension: string; }

function imageOutput(mimeType: string): XopcImageOutput {
  if (mimeType === 'image/png') return { mimeType: 'image/png', extension: 'png' };
  if (mimeType === 'image/webp') return { mimeType: 'image/webp', extension: 'webp' };
  return { mimeType: 'image/jpeg', extension: 'jpg' };
}

function editedImageName(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name || 'image';
  return stem + '.' + extension;
}

export async function editChatImageAttachment(attachment: XopcChatAttachment, rotation: number,
  aspectName: string): Promise<XopcChatAttachment> {
  if (!attachment.mimeType.startsWith('image/') || !attachment.data) throw new Error('IMAGE_EDIT_UNAVAILABLE');
  const bytes = new util.Base64Helper().decodeSync(attachment.data);
  const source = image.createImageSource(bytes.buffer);
  let pixelMap: image.PixelMap | undefined;
  const packer = image.createImagePacker();
  try {
    pixelMap = await source.createPixelMap({ editable: true });
    const normalized = ((rotation % 360) + 360) % 360;
    if (normalized) await pixelMap.rotate(normalized);
    const aspect = imageEditAspect(aspectName);
    if (aspect > 0) {
      const info = await pixelMap.getImageInfo();
      const editSize: XopcImageSize = { width: info.size.width, height: info.size.height };
      const crop = centeredImageCrop(editSize, aspect);
      if (crop.width !== info.size.width || crop.height !== info.size.height) {
        await pixelMap.crop({ x: crop.x, y: crop.y, size: { width: crop.width, height: crop.height } });
      }
    }
    const output = imageOutput(attachment.mimeType);
    const packed = await packer.packToData(pixelMap, { format: output.mimeType, quality: 92 });
    const data = new util.Base64Helper().encodeToStringSync(new Uint8Array(packed));
    return { type: 'image', name: editedImageName(attachment.name, output.extension), mimeType: output.mimeType,
      size: packed.byteLength, data };
  } finally {
    if (pixelMap) await pixelMap.release();
    await source.release();
    await packer.release();
  }
}
