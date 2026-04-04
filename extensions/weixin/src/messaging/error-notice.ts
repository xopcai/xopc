import { sendMessageWeixin } from "./send.js";

/**
 * Map send failures to user-visible copy (aligned with openclaw-weixin process-message onError).
 */
export function mapWeixinOutboundErrorNotice(errMsg: string): string {
  if (errMsg.includes("remote media download failed") || errMsg.includes("fetch")) {
    return `⚠️ 媒体文件下载失败，请检查链接是否可访问。`;
  }
  if (
    errMsg.includes("getUploadUrl") ||
    errMsg.includes("CDN upload") ||
    errMsg.includes("upload_param")
  ) {
    return `⚠️ 媒体文件上传失败，请稍后重试。`;
  }
  return `⚠️ 消息发送失败：${errMsg}`;
}

/**
 * Fire-and-forget error line to the user; logs secondary failures.
 */
export async function sendWeixinErrorNotice(params: {
  to: string;
  toUserIdForApi?: string;
  contextToken: string | undefined;
  message: string;
  baseUrl: string;
  token?: string;
  routeTag?: string;
  errLog: (m: string) => void;
}): Promise<void> {
  if (!params.contextToken) {
    params.errLog(`sendWeixinErrorNotice: no contextToken for to=${params.to}`);
  }
  try {
    await sendMessageWeixin({
      to: params.to,
      toUserIdForApi: params.toUserIdForApi,
      text: params.message,
      opts: {
        baseUrl: params.baseUrl,
        token: params.token,
        routeTag: params.routeTag,
        contextToken: params.contextToken,
      },
    });
  } catch (err) {
    params.errLog(`[weixin] sendWeixinErrorNotice failed to=${params.to}: ${String(err)}`);
  }
}
