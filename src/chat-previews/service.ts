import { createHash } from 'node:crypto';

import {
  ChatPreviewCreateInputSchema,
  ChatPreviewReviseInputSchema,
  type ChatPreviewCreateInput,
  type ChatPreviewRecord,
  type ChatPreviewRevision,
  type ChatPreviewReviseInput,
  type ChatPreviewSource,
  type ChatPreviewDiagnostic,
  type ChatPreviewFixGuidance,
  type LocalAppDetail,
} from '@xopcai/gateway-contract';

import type { LocalAppService } from '../local-apps/index.js';
import { ChatPreviewStore } from './store.js';

export class ChatPreviewNotFoundError extends Error {}
export class ChatPreviewRevisionConflictError extends Error {}

function sourceHash(source: ChatPreviewSource): string {
  const hash = createHash('sha256');
  for (const value of [source.markup, source.styles, source.script]) {
    hash.update(String(Buffer.byteLength(value)));
    hash.update(':');
    hash.update(value);
  }
  return hash.digest('hex');
}

export class ChatPreviewService {
  private readonly store: ChatPreviewStore;
  private readonly localApps?: LocalAppService;

  constructor(options: { store?: ChatPreviewStore; localApps?: LocalAppService } = {}) {
    this.store = options.store ?? new ChatPreviewStore();
    this.localApps = options.localApps;
  }

  create(conversationId: string, rawInput: ChatPreviewCreateInput): {
    preview: ChatPreviewRecord;
    revision: ChatPreviewRevision;
  } {
    const input = ChatPreviewCreateInputSchema.parse(rawInput);
    const source = { markup: input.markup, styles: input.styles, script: input.script };
    return this.store.create({
      conversationId,
      title: input.title,
      preferredHeight: input.preferredHeight,
      sourceHash: sourceHash(source),
      source,
    });
  }

  get(id: string): ChatPreviewRecord {
    const preview = this.store.get(id);
    if (!preview) throw new ChatPreviewNotFoundError('Chat preview not found');
    return preview;
  }

  getRevision(id: string, revision: string): ChatPreviewRevision {
    const result = this.store.getRevision(id, revision);
    if (!result) throw new ChatPreviewNotFoundError('Chat preview revision not found');
    return result;
  }

  revise(id: string, rawInput: ChatPreviewReviseInput): {
    preview: ChatPreviewRecord;
    revision: ChatPreviewRevision;
  } {
    this.get(id);
    const input = ChatPreviewReviseInputSchema.parse(rawInput);
    const source = { markup: input.markup, styles: input.styles, script: input.script };
    const result = this.store.revise({
      id,
      expectedRevision: input.baseRevision,
      sourceHash: sourceHash(source),
      source,
      title: input.title,
      preferredHeight: input.preferredHeight,
    });
    if (!result) throw new ChatPreviewRevisionConflictError('Chat preview changed; revise the latest revision');
    return result;
  }

  getFixGuidance(
    id: string,
    sourceHashValue: string,
    diagnostics: ChatPreviewDiagnostic[],
    locale: 'en' | 'zh',
  ): ChatPreviewFixGuidance {
    const preview = this.get(id);
    this.getRevision(id, sourceHashValue);
    const issues = JSON.stringify(diagnostics, null, 2);
    const prompt = locale === 'zh'
      ? `请修复对话预览“${preview.title}”的运行错误。先读取 previewId=${id}、sourceHash=${sourceHashValue} 的不可变版本，分析以下诊断，然后用 xopc_use 的 chat_preview/revise 提交完整 markup、styles、script，并将 baseRevision 设为 ${sourceHashValue}。不要创建 Local App。\n\n诊断：\n${issues}`
      : `Fix the runtime errors in chat preview "${preview.title}". Read immutable previewId=${id}, sourceHash=${sourceHashValue}, analyze the diagnostics below, then use xopc_use chat_preview/revise with complete markup, styles, and script and baseRevision=${sourceHashValue}. Do not create a Local App.\n\nDiagnostics:\n${issues}`;
    return { previewId: id, sourceHash: sourceHashValue, prompt };
  }

  promote(id: string, sourceHashValue: string): LocalAppDetail {
    if (!this.localApps) throw new Error('Local app service is unavailable');
    const preview = this.get(id);
    const revision = this.getRevision(id, sourceHashValue);
    const promotedAppId = this.store.getPromotedAppId(id, sourceHashValue);
    if (promotedAppId) {
      const existing = this.localApps.get(promotedAppId);
      if (!existing) throw new Error('Promoted Local App is unavailable');
      return existing;
    }
    const app = this.localApps.createFromPreview({
      name: preview.title,
      idea: preview.title,
      markup: revision.markup,
      styles: revision.styles,
      script: revision.script,
    });
    this.store.setPromotedAppId(id, sourceHashValue, app.id);
    return app;
  }
}
