import type { ImageContent } from '@earendil-works/pi-ai';

import type { AgentSourceContext } from '../agent/source-context/types.js';
import { readMediaReferenceBase64 } from '../media/media-reference.js';
import type { MediaRef } from '../media/types.js';

import type { WorkItem } from './types.js';

const MAX_NATIVE_VISION_IMAGES = 6;
const MAX_NATIVE_VISION_IMAGE_BYTES = 2 * 1024 * 1024;

function contextLine(label: string, value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? `${label}: ${text}` : null;
}

async function loadWorkItemNativeVisionImages(item: WorkItem): Promise<ImageContent[]> {
  const images: ImageContent[] = [];
  for (const attachment of item.attachments ?? []) {
    if (attachment.type !== 'image') continue;
    if (!attachment.mimeType.toLowerCase().startsWith('image/')) continue;
    if (attachment.size > MAX_NATIVE_VISION_IMAGE_BYTES) continue;
    try {
      const loaded = await readMediaReferenceBase64(attachment.mediaUri, MAX_NATIVE_VISION_IMAGE_BYTES);
      images.push({ type: 'image', data: loaded.data, mimeType: attachment.mimeType || loaded.mimeType });
      if (images.length >= MAX_NATIVE_VISION_IMAGES) break;
    } catch {
      continue;
    }
  }
  return images;
}

function renderAttachmentLines(item: WorkItem, refs?: readonly MediaRef[]): string {
  if (!item.attachments?.length) return '';
  return item.attachments
    .slice(0, 12)
    .map((attachment, index) => {
      const ref = refs?.[index];
      return [
        `- ${ref?.name ?? attachment.fileName} (${ref?.mimeType ?? attachment.mimeType}, ${ref?.size ?? attachment.size} bytes)`,
        `  xopc-media-uri:${ref?.uri ?? attachment.mediaUri}`,
        '  Use the read_media tool with the xopc-media-uri value when you need to inspect this attachment.',
      ].join('\n');
    })
    .join('\n');
}

export async function buildWorkItemAgentContext(
  item: WorkItem,
  opts: { attachments?: readonly MediaRef[]; includeImages?: boolean } = {},
): Promise<AgentSourceContext> {
  const links = item.links?.length
    ? item.links
      .slice(0, 12)
      .map((link) => `- ${link.kind}: ${link.title || link.targetId}${link.statusSnapshot ? ` (${link.statusSnapshot})` : ''}`)
      .join('\n')
    : '';
  const attachments = renderAttachmentLines(item, opts.attachments);
  const images = opts.includeImages === false ? [] : await loadWorkItemNativeVisionImages(item);
  const text = [
    'You are working inside a project work item. Treat this as the active task context, not as a new user message.',
    '',
    contextLine('Work item id', item.id),
    contextLine('Project id', item.projectId),
    contextLine('Title', item.title),
    contextLine('Status', item.status),
    contextLine('Priority', item.priority),
    contextLine('Owner agent', item.ownerAgentId),
    contextLine('Description', item.description),
    contextLine('Next action', item.nextAction),
    contextLine('Blocked reason', item.blockedReason),
    item.dueAt ? contextLine('Due at', new Date(item.dueAt).toISOString()) : null,
    links ? `Linked executions:\n${links}` : null,
    attachments ? `Attachments:\n${attachments}` : null,
    '',
    'When you answer, keep the work item moving. If the discussion changes scope, call out the suggested work item update explicitly.',
  ].filter(Boolean).join('\n');

  return {
    kind: 'work_item',
    sourceId: item.id,
    version: String(item.updatedAt),
    title: item.title,
    text,
    ...(images.length ? { images } : {}),
  };
}
