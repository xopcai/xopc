import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';

import { extractMobileProductDelivery } from './product-delivery';
import { imageContentBlocksToAttachments } from './image-content-attachments';
import type { ImageContent, Message, MessageAttachment, ToolUseContent } from './messages.types';
import { asRecord, parseToolResult } from './parse-tool-result';
import {
  absolutePathSameAsWorkspaceRelative,
  looksLikeAbsoluteFilePath,
  mimeTypeFromFileName,
  type ExtractedFilePath,
} from './tool-result-file-paths';
import { dedupeAttachments, normalizeWireAttachments } from './wire-attachments';

const DELIVERABLE_TOOL_NAMES = new Set([
  'write_file',
  'apply_patch',
  'image_generate',
  'send_media',
  'create_share',
  'workflow',
  'automation',
  'xopc_use',
]);

export type AssistantDeliverables = {
  workspacePaths: ExtractedFilePath[];
  attachments: MessageAttachment[];
  productDeliveries: ProductDeliveryEnvelope[];
  awaiting: boolean;
};

function toolDetails(block: ToolUseContent): Record<string, unknown> {
  return {
    ...(parseToolResult(block.result).details ?? {}),
    ...(asRecord(block.details) ?? {}),
  };
}

function safeWorkspaceRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('\0')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return null;
  if (normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

function extractedPath(value: unknown): ExtractedFilePath | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  const absolute = looksLikeAbsoluteFilePath(input);
  const workspaceRelativePath = absolute ? undefined : safeWorkspaceRelativePath(input);
  if (!absolute && !workspaceRelativePath) return null;
  const normalized = absolute ? input.replace(/\\/g, '/') : workspaceRelativePath!;
  const fileName = normalized.split('/').filter(Boolean).pop() ?? normalized;
  return {
    absolutePath: absolute ? normalized : `rel:${normalized}`,
    fileName,
    mimeType: mimeTypeFromFileName(fileName),
    workspaceRelativePath: workspaceRelativePath ?? undefined,
    startIndex: 0,
    endIndex: 0,
  };
}

function filePathsFromDetails(block: ToolUseContent, details: Record<string, unknown>): ExtractedFilePath[] {
  const candidates: unknown[] = [];
  if (block.name === 'write_file') {
    candidates.push(details.path);
  } else if (block.name === 'apply_patch') {
    const files = Array.isArray(details.files) ? details.files : [];
    candidates.push(...files);
    if (files.length === 0 && Array.isArray(details.changes)) {
      for (const change of details.changes) {
        const record = asRecord(change);
        candidates.push(record?.moveTo ?? record?.path);
      }
    }
  } else if (block.name === 'image_generate') {
    const media = normalizeWireAttachments(details.media);
    if (!media?.length && Array.isArray(details.workspaceRelativePaths)) {
      candidates.push(...details.workspaceRelativePaths);
    }
  } else if (block.name === 'create_share') {
    candidates.push(asRecord(block.input)?.filePath);
  }
  return candidates.map(extractedPath).filter((path): path is ExtractedFilePath => path !== null);
}

function productFilePaths(delivery: ProductDeliveryEnvelope | null): ExtractedFilePath[] {
  if (!delivery) return [];
  return [delivery.primary, ...(delivery.related ?? [])]
    .filter((reference) => reference?.kind === 'file')
    .map((reference) => extractedPath(reference!.id))
    .filter((path): path is ExtractedFilePath => path !== null);
}

function pathsMatch(left: ExtractedFilePath, right: ExtractedFilePath): boolean {
  if (left.workspaceRelativePath && right.workspaceRelativePath) {
    return left.workspaceRelativePath === right.workspaceRelativePath;
  }
  if (left.workspaceRelativePath && looksLikeAbsoluteFilePath(right.absolutePath)) {
    return absolutePathSameAsWorkspaceRelative(right.absolutePath, left.workspaceRelativePath);
  }
  if (right.workspaceRelativePath && looksLikeAbsoluteFilePath(left.absolutePath)) {
    return absolutePathSameAsWorkspaceRelative(left.absolutePath, right.workspaceRelativePath);
  }
  return left.absolutePath === right.absolutePath;
}

function dedupePaths(paths: readonly ExtractedFilePath[]): ExtractedFilePath[] {
  const result: ExtractedFilePath[] = [];
  for (const path of paths) {
    const existing = result.find((candidate) => pathsMatch(candidate, path));
    if (!existing) {
      result.push(path);
      continue;
    }
    if (!existing.workspaceRelativePath && path.workspaceRelativePath) {
      existing.workspaceRelativePath = path.workspaceRelativePath;
    }
  }
  return result;
}

function attachmentOverlapsPath(attachment: MessageAttachment, path: ExtractedFilePath): boolean {
  const relative = attachment.workspaceRelativePath?.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (relative && path.workspaceRelativePath === relative) return true;
  if (relative && looksLikeAbsoluteFilePath(path.absolutePath)) {
    return absolutePathSameAsWorkspaceRelative(path.absolutePath, relative);
  }
  return Boolean(attachment.path && attachment.path === path.absolutePath);
}

function attachmentMediaKey(attachment: MessageAttachment): string {
  return attachment.uri?.trim()
    || attachment.workspaceRelativePath?.trim()
    || attachment.name?.trim()
    || '';
}

function deliveryKey(delivery: ProductDeliveryEnvelope): string {
  const reference = delivery.primary;
  return `${delivery.operation}:${reference?.kind ?? 'none'}:${reference?.id ?? 'none'}`;
}

export function collectAssistantDeliverables(
  message: Message,
  isStreaming: boolean,
): AssistantDeliverables {
  const tools = message.content.filter(
    (block): block is ToolUseContent => block.type === 'tool_use',
  );
  const completedTools = tools.filter((block) => block.status === 'done');
  const deliveries = completedTools
    .map(extractMobileProductDelivery)
    .filter((delivery): delivery is ProductDeliveryEnvelope => delivery !== null);
  const workspacePaths = dedupePaths(completedTools.flatMap((block) => {
    const details = toolDetails(block);
    return [
      ...filePathsFromDetails(block, details),
      ...productFilePaths(extractMobileProductDelivery(block)),
    ];
  }));
  const toolMedia = completedTools.flatMap((block) => (
    normalizeWireAttachments(toolDetails(block).media) ?? []
  ));
  const imageBlocks = message.content.filter(
    (block): block is ImageContent => block.type === 'image' && Boolean(block.source?.data),
  );
  const inlineMediaKeys = new Set(
    message.content
      .filter((block) => block.type === 'audio')
      .map((block) => block.uri?.trim() || block.workspaceRelativePath?.trim() || block.name?.trim() || '')
      .filter(Boolean),
  );
  const attachments = dedupeAttachments([
    ...imageContentBlocksToAttachments(imageBlocks),
    ...toolMedia,
    ...(message.attachments ?? []),
  ])?.filter((attachment) => (
    !workspacePaths.some((path) => attachmentOverlapsPath(attachment, path))
    && !inlineMediaKeys.has(attachmentMediaKey(attachment))
  )) ?? [];
  const productDeliveries = Array.from(
    new Map(
      deliveries
        .filter((delivery) => delivery.primary?.kind !== 'file')
        .map((delivery) => [deliveryKey(delivery), delivery]),
    ).values(),
  );

  return {
    workspacePaths,
    attachments,
    productDeliveries,
    awaiting: isStreaming && tools.some(
      (block) => block.status === 'running' && DELIVERABLE_TOOL_NAMES.has(block.name),
    ),
  };
}
