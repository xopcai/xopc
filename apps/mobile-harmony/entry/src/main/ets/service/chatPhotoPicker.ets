import { common } from '@kit.AbilityKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { camera, cameraPicker } from '@kit.CameraKit';
import { XopcChatAttachment } from '../model/chat';
import { readChatAttachment } from './chatAttachmentPicker';

export async function pickChatPhoto(context: common.Context, current: XopcChatAttachment[], takePhoto: boolean): Promise<XopcChatAttachment | undefined> {
  let uri: string = '';
  if (takePhoto) {
    const result = await cameraPicker.pick(context, [cameraPicker.PickerMediaType.PHOTO], { cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK });
    if (result.resultCode !== 0) return undefined;
    uri = result.resultUri;
  } else {
    const result = await new photoAccessHelper.PhotoViewPicker().select({ MIMEType: photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE, maxSelectNumber: 1 });
    uri = result.photoUris[0] || '';
  }
  return uri ? await readChatAttachment(uri, current) : undefined;
}
