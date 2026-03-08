/**
 * Feishu Media Handler - Download and upload media files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createFeishuClient } from './client.js';
import type { FeishuConfig, FeishuMediaInfo } from './types.js';

/**
 * Parse media keys from message content
 */
export function parseMediaKeys(
  content: string,
  messageType: string
): { imageKey?: string; fileKey?: string; fileName?: string } {
  try {
    const parsed = JSON.parse(content);
    switch (messageType) {
      case 'image':
        return { imageKey: parsed.image_key };
      case 'file':
        return { fileKey: parsed.file_key, fileName: parsed.file_name };
      case 'audio':
        return { fileKey: parsed.file_key };
      case 'video':
        return { fileKey: parsed.file_key, imageKey: parsed.image_key };
      case 'sticker':
        return { fileKey: parsed.file_key };
      default:
        return {};
    }
  } catch {
    return {};
  }
}

/**
 * Parse post (rich text) content and extract embedded images
 */
export function parsePostContent(content: string): {
  textContent: string;
  imageKeys: string[];
} {
  try {
    const parsed = JSON.parse(content);
    const title = parsed.title || '';
    const contentBlocks = parsed.content || [];
    let textContent = title ? `${title}\n\n` : '';
    const imageKeys: string[] = [];

    for (const paragraph of contentBlocks) {
      if (Array.isArray(paragraph)) {
        for (const element of paragraph) {
          if (element.tag === 'text') {
            textContent += element.text || '';
          } else if (element.tag === 'a') {
            textContent += element.text || element.href || '';
          } else if (element.tag === 'at') {
            textContent += `@${element.user_name || element.user_id || ''}`;
          } else if (element.tag === 'img' && element.image_key) {
            imageKeys.push(element.image_key);
          }
        }
        textContent += '\n';
      }
    }

    return {
      textContent: textContent.trim() || '[富文本消息]',
      imageKeys,
    };
  } catch {
    return { textContent: '[富文本消息]', imageKeys: [] };
  }
}

/**
 * Infer placeholder based on message type
 */
export function inferPlaceholder(messageType: string): string {
  switch (messageType) {
    case 'image':
      return '<media:image>';
    case 'file':
      return '<media:document>';
    case 'audio':
      return '<media:audio>';
    case 'video':
      return '<media:video>';
    case 'sticker':
      return '<media:sticker>';
    default:
      return '<media:document>';
  }
}

/**
 * Get file extension from content type
 */
function getExtension(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/json': '.json',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'video/mp4': '.mp4',
  };
  return map[contentType] || '';
}

/**
 * Download message resource (image/file)
 */
export async function downloadMessageResource(params: {
  config: FeishuConfig;
  messageId: string;
  fileKey: string;
  type: 'image' | 'file';
}): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }> {
  const { config, messageId, fileKey, type } = params;
  const client = createFeishuClient(config);

  if (type === 'image') {
    // For images, use message resource API
    const response: any = await client.im.messageResource.get({
      path: { message_id: messageId },
      params: { file_key: fileKey, type: 'image' },
    });
    
    if (response?.data) {
      const buffer = Buffer.from(response.data);
      return { buffer, contentType: 'image/jpeg' };
    }
    throw new Error('Failed to download image');
  } else {
    // For files, use message resource API
    const response: any = await client.im.messageResource.get({
      path: { message_id: messageId },
      params: { file_key: fileKey, type: 'file' },
    });
    
    if (response?.data) {
      const buffer = Buffer.from(response.data);
      return { buffer, contentType: 'application/octet-stream' };
    }
    throw new Error('Failed to download file');
  }
}

/**
 * Resolve media from a message and save to temp directory
 */
export async function resolveFeishuMediaList(params: {
  config: FeishuConfig;
  messageId: string;
  messageType: string;
  content: string;
  maxBytes: number;
  log?: (msg: string) => void;
}): Promise<FeishuMediaInfo[]> {
  const { config, messageId, messageType, content, maxBytes, log } = params;

  const mediaTypes = ['image', 'file', 'audio', 'video', 'sticker', 'post'];
  if (!mediaTypes.includes(messageType)) {
    return [];
  }

  const out: FeishuMediaInfo[] = [];

  // Handle post (rich text) with embedded images
  if (messageType === 'post') {
    const { imageKeys } = parsePostContent(content);
    if (imageKeys.length === 0) return [];

    log?.(`Post contains ${imageKeys.length} embedded image(s)`);

    for (const imageKey of imageKeys) {
      try {
        const result = await downloadMessageResource({
          config,
          messageId,
          fileKey: imageKey,
          type: 'image',
        });

        const ext = getExtension(result.contentType || 'image/jpeg');
        const tmpPath = path.join(os.tmpdir(), `feishu-${Date.now()}-${imageKey}${ext}`);
        fs.writeFileSync(tmpPath, result.buffer);

        out.push({
          path: tmpPath,
          contentType: result.contentType,
          placeholder: '<media:image>',
        });

        log?.(`Downloaded embedded image: ${tmpPath}`);
      } catch (err) {
        log?.(`Failed to download embedded image ${imageKey}: ${err}`);
      }
    }

    return out;
  }

  // Handle other media types
  const mediaKeys = parseMediaKeys(content, messageType);
  if (!mediaKeys.imageKey && !mediaKeys.fileKey) return [];

  try {
    const fileKey = mediaKeys.imageKey || mediaKeys.fileKey;
    if (!fileKey) return [];

    const resourceType = messageType === 'image' ? 'image' : 'file';
    const result = await downloadMessageResource({
      config,
      messageId,
      fileKey,
      type: resourceType,
    });

    // Check size limit
    if (result.buffer.length > maxBytes) {
      log?.(`Media too large: ${result.buffer.length} bytes > ${maxBytes}`);
      return [];
    }

    const ext = getExtension(result.contentType || 'application/octet-stream');
    const tmpPath = path.join(os.tmpdir(), `feishu-${Date.now()}-${fileKey}${ext}`);
    fs.writeFileSync(tmpPath, result.buffer);

    out.push({
      path: tmpPath,
      contentType: result.contentType,
      placeholder: inferPlaceholder(messageType),
    });

    log?.(`Downloaded ${messageType}: ${tmpPath}`);
  } catch (err) {
    log?.(`Failed to download ${messageType}: ${err}`);
  }

  return out;
}

/**
 * Upload image to Feishu
 */
export async function uploadImageToFeishu(
  config: FeishuConfig,
  imagePath: string
): Promise<string> {
  const client = createFeishuClient(config);
  const buffer = fs.readFileSync(imagePath);
  
  const response: any = await client.im.image.create({
    data: { image: buffer },
  });
  
  if (response?.data?.image_key) {
    return response.data.image_key;
  }
  throw new Error('Failed to upload image');
}

/**
 * Upload file to Feishu
 */
export async function uploadFileToFeishu(
  config: FeishuConfig,
  filePath: string,
  fileName?: string
): Promise<string> {
  const client = createFeishuClient(config);
  const buffer = fs.readFileSync(filePath);
  const name = fileName || path.basename(filePath);
  
  const response: any = await client.im.file.create({
    data: {
      file_name: name,
      file: buffer,
    },
  });
  
  if (response?.data?.file_key) {
    return response.data.file_key;
  }
  throw new Error('Failed to upload file');
}
