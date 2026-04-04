import path from "node:path";
import type { WeixinApiOptions } from "../api/api.js";
import { toRawIlinkUserIdForApi } from "../auth/weixin-account-id.js";
import { logger } from "../util/logger.js";
import { getMimeFromFilename } from "../media/mime.js";
import { sendFileMessageWeixin, sendImageMessageWeixin, sendVideoMessageWeixin } from "./send.js";
import { uploadFileAttachmentToWeixin, uploadFileToWeixin, uploadVideoToWeixin } from "../cdn/upload.js";

/**
 * Upload a local file and send it as a weixin message, routing by MIME type:
 *   video/*  → uploadVideoToWeixin        + sendVideoMessageWeixin
 *   image/*  → uploadFileToWeixin         + sendImageMessageWeixin
 *   else     → uploadFileAttachmentToWeixin + sendFileMessageWeixin
 *
 * Used by both the auto-reply deliver path (monitor.ts) and the outbound
 * sendMedia path (channel.ts) so they stay in sync.
 *
 * `audio/*` (e.g. TTS mp3) hits the `else` branch — same as openclaw-weixin (file attachment, not VoiceItem).
 */
export async function sendWeixinMediaFile(params: {
  filePath: string;
  to: string;
  toUserIdForApi?: string;
  text: string;
  opts: WeixinApiOptions & { contextToken?: string };
  cdnBaseUrl: string;
}): Promise<{ messageId: string }> {
  const { filePath, to, text, opts, cdnBaseUrl } = params;
  const apiTo = params.toUserIdForApi?.trim() || toRawIlinkUserIdForApi(to);
  const mime = getMimeFromFilename(filePath);
  /** openclaw-weixin `channel.ts`: `{ baseUrl, token }` only; xopcbot adds `routeTag` for `SKRouteTag` on getUploadUrl. */
  const uploadOpts: WeixinApiOptions = { baseUrl: opts.baseUrl, token: opts.token };
  if (opts.routeTag?.trim()) {
    uploadOpts.routeTag = opts.routeTag;
  }

  if (mime.startsWith("video/")) {
    logger.info(`[weixin] sendWeixinMediaFile: uploading video filePath=${filePath} to=${to}`);
    const uploaded = await uploadVideoToWeixin({
      filePath,
      toUserId: apiTo,
      opts: uploadOpts,
      cdnBaseUrl,
    });
    logger.info(
      `[weixin] sendWeixinMediaFile: video upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`,
    );
    return sendVideoMessageWeixin({ to, toUserIdForApi: apiTo, text, uploaded, opts });
  }

  if (mime.startsWith("image/")) {
    logger.info(`[weixin] sendWeixinMediaFile: uploading image filePath=${filePath} to=${to}`);
    const uploaded = await uploadFileToWeixin({
      filePath,
      toUserId: apiTo,
      opts: uploadOpts,
      cdnBaseUrl,
    });
    logger.info(
      `[weixin] sendWeixinMediaFile: image upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`,
    );
    return sendImageMessageWeixin({ to, toUserIdForApi: apiTo, text, uploaded, opts });
  }

  // File attachment: pdf, doc, zip, etc.
  const fileName = path.basename(filePath);
  logger.info(
    `[weixin] sendWeixinMediaFile: uploading file attachment filePath=${filePath} name=${fileName} to=${to}`,
  );
  const uploaded = await uploadFileAttachmentToWeixin({
    filePath,
    fileName,
    toUserId: apiTo,
    opts: uploadOpts,
    cdnBaseUrl,
  });
  logger.info(
    `[weixin] sendWeixinMediaFile: file upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`,
  );
  return sendFileMessageWeixin({ to, toUserIdForApi: apiTo, text, fileName, uploaded, opts });
}
