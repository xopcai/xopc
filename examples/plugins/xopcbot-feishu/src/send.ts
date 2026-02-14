/**
 * Feishu Message Sender
 */

import { createFeishuClient } from './client.js';
import { uploadImageToFeishu, uploadFileToFeishu } from './media.js';
import type { FeishuConfig } from './types.js';

export interface SendMessageParams {
  config: FeishuConfig;
  to: string; // chat_id or user open_id
  text?: string;
  imagePath?: string;
  filePath?: string;
  fileName?: string;
  replyToMessageId?: string;
}

/**
 * Send text message
 */
export async function sendTextMessage(params: SendMessageParams): Promise<void> {
  const { config, to, text, replyToMessageId } = params;
  const client = createFeishuClient(config);

  const receiveId = to.startsWith('user:') ? to.slice(5) : to;
  const receiveIdType = to.startsWith('user:') ? 'open_id' : 'chat_id';

  const response: any = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content: JSON.stringify({ text: text || '' }),
      msg_type: 'text',
      ...(replyToMessageId ? { reply_in_thread: true, root_id: replyToMessageId } : {}),
    },
  });

  if (!response?.data?.message_id) {
    throw new Error(`Failed to send message: ${JSON.stringify(response)}`);
  }
}

/**
 * Send image message
 */
export async function sendImageMessage(params: SendMessageParams): Promise<void> {
  const { config, to, imagePath, replyToMessageId } = params;
  const client = createFeishuClient(config);

  // Upload image first
  const imageKey = await uploadImageToFeishu(config, imagePath!);

  const receiveId = to.startsWith('user:') ? to.slice(5) : to;
  const receiveIdType = to.startsWith('user:') ? 'open_id' : 'chat_id';

  const response: any = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content: JSON.stringify({ image_key: imageKey }),
      msg_type: 'image',
      ...(replyToMessageId ? { reply_in_thread: true, root_id: replyToMessageId } : {}),
    },
  });

  if (!response?.data?.message_id) {
    throw new Error(`Failed to send image: ${JSON.stringify(response)}`);
  }
}

/**
 * Send file message
 */
export async function sendFileMessage(params: SendMessageParams): Promise<void> {
  const { config, to, filePath, fileName, replyToMessageId } = params;
  const client = createFeishuClient(config);

  // Upload file first
  const fileKey = await uploadFileToFeishu(config, filePath!, fileName);

  const receiveId = to.startsWith('user:') ? to.slice(5) : to;
  const receiveIdType = to.startsWith('user:') ? 'open_id' : 'chat_id';

  const response: any = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content: JSON.stringify({ file_key: fileKey, file_name: fileName || filePath }),
      msg_type: 'file',
      ...(replyToMessageId ? { reply_in_thread: true, root_id: replyToMessageId } : {}),
    },
  });

  if (!response?.data?.message_id) {
    throw new Error(`Failed to send file: ${JSON.stringify(response)}`);
  }
}

/**
 * Send message with auto-detection of type
 */
export async function sendMessage(params: SendMessageParams): Promise<void> {
  if (params.imagePath) {
    return sendImageMessage(params);
  }
  if (params.filePath) {
    return sendFileMessage(params);
  }
  return sendTextMessage(params);
}

/**
 * Get message by ID
 */
export async function getMessage(
  config: FeishuConfig,
  messageId: string
): Promise<{ content: string; messageType: string } | null> {
  const client = createFeishuClient(config);

  try {
    const response: any = await client.im.message.get({
      path: { message_id: messageId },
    });

    if (response?.data) {
      return {
        content: response.data.content,
        messageType: response.data.msg_type,
      };
    }
    return null;
  } catch {
    return null;
  }
}
