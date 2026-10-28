import { XopcIncomingShare, XopcIncomingShareAttachment } from '../model/share';
import { XopcChatDraft, XopcChatDrafts } from './chatDrafts';
import { localSessionStore } from './localSessionStore';
import { readChatAttachment } from './chatAttachmentPicker';
import { gatewaySession } from './gatewaySession';
import { attachmentMime } from '../common/attachments';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { XopcNoteMediaService } from './noteMedia';
import { XopcNoteRepository } from '../repository/noteRepository';
import { XopcNoteAttachment, XopcNoteDraft } from '../model/note';

interface XopcIntakeSessionResponse { session?: XopcIntakeSessionStatus; }
interface XopcIntakeSessionStatus { status?: string; }
interface XopcShareCaptureBody { text: string; channel: string; platform: string; }
interface XopcShareCaptureResult { note?: XopcShareCaptureNote; }
interface XopcShareCaptureNote { id: string; }
interface XopcShareHandoff { intakeId?: string; createdAt?: number; issues?: string[]; title: string; values: string[]; attachments?: XopcIncomingShareAttachment[]; }

export const SHARE_INTAKE_URI = 'xopc://intake';

const SECRET_ASSIGNMENT = /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)(["']?)[^\n,;]+(["']?)/gi;
const JWT = /\beyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /\b(?:\+?\d[\d -]{8,}\d)\b/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const SECRET = /\b(?:bearer\s+[a-z0-9._~+/-]{16,}|sk-[a-z0-9_-]{16,})\b/gi;
const OTP = /(?:验证码|校验码|动态码|verification code|security code|auth code|login code|one-time|otp)[\s\S]{0,80}\b\d{4,8}\b/i;
const URL_ONLY = /^https?:\/\/[^\s<>)"']+$/i;
const ANY_URL = /https?:\/\/[^\s<>)"']+/i;
const CODE = /\b(import|export|function|class|interface|type|const|let|var|return|async|await|SELECT|FROM|WHERE)\b|[{};]\s*$/m;

function kindOf(content: string): 'url' | 'code' | 'todo' | 'long-text' | 'text' {
  if (URL_ONLY.test(content) || (ANY_URL.test(content) && content.split('\n').length <= 2)) return 'url';
  if (/^(?:[-*]\s*)?(?:\[[ xX]?\]|todo:)/im.test(content)) return 'todo';
  if ((CODE.test(content) && content.includes('\n')) || /^```[\s\S]*```$/.test(content)) return 'code';
  if (content.length >= 420 || content.split('\n').length >= 8) return 'long-text';
  return 'text';
}

function promptFor(kind: 'url' | 'code' | 'todo' | 'long-text' | 'text', content: string): string {
  if (kind === 'url') return '请阅读并总结这个链接，提炼关键内容、风险和下一步建议：\n\n' + content;
  if (kind === 'code') return '请解释这段代码的作用，并指出可以改进或需要注意的地方：\n\n' + content;
  if (kind === 'todo') return '请把下面的清单整理成清晰的行动计划，按优先级和下一步输出：\n\n' + content;
  if (kind === 'long-text') return '请总结下面内容，提炼核心观点、待办事项和可追问的问题：\n\n' + content;
  return '请围绕下面内容展开分析，给出有价值的观察和下一步建议：\n\n' + content;
}

function noteText(value: XopcIncomingShare): string {
  if (value.kind === 'url') {
    const lines = value.content.split('\n').map((line: string): string => line.trim()).filter((line: string): boolean => !!line);
    if (lines.length === 2 && URL_ONLY.test(lines[1]) && !URL_ONLY.test(lines[0])) {
      return '[' + lines[0].replace(/([\[\]\\])/g, '\\$1') + '](' + lines[1] + ')';
    }
  }
  if (value.kind === 'todo') return value.content.split('\n').map((line: string): string => {
    const text = line.trim().replace(/^[-*]\s*/, '').replace(/^todo:\s*/i, '');
    if (/^\[[xX]\]\s*/.test(text)) return '- [x] ' + text.replace(/^\[[xX]\]\s*/, '');
    return '- [ ] ' + text.replace(/^\[ \]\s*/, '');
  }).join('\n');
  if (value.kind === 'code' && !/^```[\s\S]*```$/.test(value.content)) return '```\n' + value.content + '\n```';
  return value.content;
}

export function incomingShare(title: string, values: string[], attachments: XopcIncomingShareAttachment[] = []): XopcIncomingShare | undefined {
  const cleaned = values.map((value: string): string => value.trim()).filter((value: string): boolean => !!value);
  const label = title.trim();
  const raw = cleaned.join('\n').trim();
  const content = label && cleaned.length === 1 && URL_ONLY.test(cleaned[0]) ? label + '\n' + cleaned[0]
    : raw || label || attachments.map((item: XopcIncomingShareAttachment): string => item.name).join('\n');
  if (!attachments.length && (content.length < 3 || content.length > 100000 || !/[A-Za-z0-9\u3400-\u9FFF]/.test(content)
    || /^[\d\s-]{3,8}$/.test(content) || (content.length <= 160 && OTP.test(content)))) return undefined;
  const sensitive = SECRET_ASSIGNMENT.test(content) || JWT.test(content) || EMAIL.test(content) || PHONE.test(content)
    || CARD.test(content) || SECRET.test(content);
  SECRET_ASSIGNMENT.lastIndex = 0; JWT.lastIndex = 0; EMAIL.lastIndex = 0; PHONE.lastIndex = 0; CARD.lastIndex = 0; SECRET.lastIndex = 0;
  const preview = sensitive ? content.replace(JWT, '[token hidden]').replace(EMAIL, '[email hidden]').replace(CARD, '[number hidden]')
    .replace(PHONE, '[phone hidden]').replace(SECRET_ASSIGNMENT, '$1$2$3[hidden]$4').replace(SECRET, 'Bearer [hidden]') : content;
  JWT.lastIndex = 0; EMAIL.lastIndex = 0; PHONE.lastIndex = 0; CARD.lastIndex = 0; SECRET.lastIndex = 0; SECRET_ASSIGNMENT.lastIndex = 0;
  const kind = kindOf(content);
  return { sharedText: raw, title: title.trim(), content, chatPrompt: promptFor(kind, content), kind, preview: preview.slice(0, 1200), sensitive,
    attachments: attachments.length ? attachments : undefined };
}

export function encodeShareHandoff(title: string, values: string[], attachments: XopcIncomingShareAttachment[] = [], issues: string[] = []): string {
  const handoff: XopcShareHandoff = { intakeId: util.generateRandomUUID(), createdAt: Date.now(), issues, title, values, attachments: attachments.length ? attachments : undefined };
  return JSON.stringify(handoff);
}

export function decodeShareHandoff(payload: string): XopcIncomingShare | undefined {
  try {
    const handoff = JSON.parse(payload) as XopcShareHandoff;
    if (typeof handoff.title !== 'string' || !Array.isArray(handoff.values)) return undefined;
    const values: string[] = [];
    for (let index = 0; index < handoff.values.length; index++) {
      const value = handoff.values[index];
      if (typeof value !== 'string') return undefined;
      values.push(value);
    }
    const attachments: XopcIncomingShareAttachment[] = [];
    if (Array.isArray(handoff.attachments)) {
      for (const item of handoff.attachments) {
        if (!item || typeof item.path !== 'string' || typeof item.name !== 'string' || typeof item.mimeType !== 'string'
          || typeof item.size !== 'number' || item.size <= 0 || item.size > 10 * 1024 * 1024
          || !/\/files\/share-[0-9a-f-]{36}-[^/]+$/i.test(item.path) || item.name.includes('/') || item.name.includes('\\')) {
          return undefined;
        }
        attachments.push({ path: item.path, name: item.name, mimeType: item.mimeType, size: item.size });
      }
    }
    const received = incomingShare(handoff.title, values, attachments);
    if (!received && !handoff.issues?.length) return undefined;
    const result: XopcIncomingShare = received ?? { title: handoff.title, content: '', chatPrompt: '', kind: 'text', preview: '', sensitive: false };
    result.intakeId = handoff.intakeId; result.createdAt = handoff.createdAt; result.issues = handoff.issues;
    return result;
  } catch (_) { return undefined; }
}

@ObservedV2
export class XopcShareIntake {
  @Trace pending?: XopcIncomingShare;
  @Trace revision: number = 0;
  @Trace chatText: string = '';
  @Trace chatRevision: number = 0;
  @Trace chatConversationId: string = '';
  @Trace queuedCount: number = 0;
  @Trace persistenceError: string = '';
  liveDraftScope: () => string = (): string => '';
  readLiveDraft: () => XopcChatDraft = (): XopcChatDraft => ({ text: '', refs: [], files: [] });
  applyLiveDraft: (draft: XopcChatDraft) => void = (_draft: XopcChatDraft): void => {};
  private queue: XopcIncomingShare[] = [];
  private directory: string = '';
  private ready: boolean = false;
  private writes: Promise<void> = Promise.resolve();
  private drafts: XopcChatDrafts = new XopcChatDrafts();
  async initialize(directory: string): Promise<void> {
    this.directory = directory;
    const raw = await localSessionStore.readComposer('@external-intake');
    if (raw) {
      try {
        const stored = JSON.parse(raw) as XopcIncomingShare[];
        for (const item of stored) {
          if (!item.targetScope && Date.now() - (item.createdAt ?? Date.now()) > 86400000) { this.cleanupShareFiles(item); continue; }
          if (!this.queue.some((other: XopcIncomingShare): boolean => other.intakeId === item.intakeId)) this.queue.push(item);
        }
      } catch (_error) { this.persistenceError = 'SHARE_RECOVERY_FAILED'; }
    }
    for (const name of await fs.listFile(directory)) {
      if (!/^intake-[0-9a-f-]{36}\.json$/.test(name)) continue;
      try {
        const recovered = decodeShareHandoff(await fs.readText(directory + '/' + name));
        if (!recovered || this.queue.some((item: XopcIncomingShare): boolean => item.intakeId === recovered.intakeId)) continue;
        if (Date.now() - (recovered.createdAt ?? Date.now()) > 86400000) { this.cleanupShareFiles(recovered); continue; }
        this.queue.push(recovered);
      } catch (_error) { this.persistenceError = 'SHARE_RECOVERY_FAILED'; }
    }
    this.ready = true; this.pending = this.queue[0]; this.queuedCount = this.queue.length; this.revision++;
    await this.persist();
  }
  private persist(): Promise<void> {
    if (!this.ready) return Promise.resolve();
    const payload = JSON.stringify(this.queue);
    const pending = this.writes.then((): Promise<void> => localSessionStore.writeComposer('@external-intake', payload));
    this.writes = pending.catch((error: Error): void => { this.persistenceError = error.message; });
    return pending;
  }
  async removeAttachment(path: string): Promise<void> {
    const incoming = this.pending; if (!incoming) return;
    incoming.attachments = (incoming.attachments ?? []).filter((file: XopcIncomingShareAttachment): boolean => file.path !== path);
    this.revision++;
    await this.persist();
    await fs.unlink(path);
  }
  async addToChat(conversationId: string): Promise<void> {
    const incoming = this.pending; if (!incoming) throw new Error('SHARE_NOT_FOUND');
    const profile = gatewaySession.currentProfile();
    if (!profile) throw new Error('GATEWAY_PROFILE_REQUIRED');
    const connection = gatewaySession.connectionRevision();
    if (!await localSessionStore.read(conversationId)) {
      const response = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(conversationId))) as XopcIntakeSessionResponse;
      if (!response.session || response.session.status === 'archived') throw new Error('SHARE_TARGET_UNAVAILABLE');
    }
    const scope = JSON.stringify([profile.gatewayId, profile.deviceId, conversationId]);
    if (incoming.targetScope && incoming.targetScope !== scope) throw new Error('SHARE_TARGET_CHANGED');
    let draft = this.liveDraftScope() === scope ? this.readLiveDraft() : await this.drafts.read(scope);
    draft = draft ?? { text: '', refs: [], files: [] };
    const receipt = incoming.intakeId || '';
    if (!draft.intakeReceipts?.includes(receipt)) {
      const files = draft.files.slice();
      for (const item of incoming.attachments ?? []) {
        const loaded = await readChatAttachment(item.path, files);
        loaded.name = item.name; loaded.mimeType = item.mimeType; loaded.type = item.mimeType.startsWith('image/') ? 'image' : 'document';
        files.push(loaded);
      }
      gatewaySession.assertConnection(connection);
      const shared = incoming.sharedText || '';
      const text = draft.text + (shared ? (draft.text ? '\n\n' : '') + shared : '');
      if (text.length > 20000) throw new Error('SHARE_TEXT_TOO_LONG');
      draft = { text, files, refs: draft.refs, intakeReceipts: (draft.intakeReceipts ?? []).concat([receipt]) };
      incoming.targetScope = scope; incoming.targetConversationId = conversationId;
      await this.persist();
      await this.drafts.save(scope, draft);
    }
    gatewaySession.assertConnection(connection);
    if (this.liveDraftScope() === scope) this.applyLiveDraft(draft);
    this.dismiss();
    await this.persist();
  }
  private media: XopcNoteMediaService = new XopcNoteMediaService();
  private notes: XopcNoteRepository = new XopcNoteRepository();
  private captureIntakeId: string = '';
  private saveMutationId: string = '';
  private attachmentMutationIds: string[] = [];

  async receiveFile(directory: string, uri: string): Promise<void> {
    let path: string = '';
    try {
      const file = await fs.open(uri, fs.OpenMode.READ_ONLY);
      let attachment: XopcIncomingShareAttachment;
      try {
        const size = (await fs.stat(file.fd)).size;
        if (size <= 0 || size > 10 * 1024 * 1024) throw new Error('File must be between 1 byte and 10 MB');
        const name = (new fileUri.FileUri(uri).name || 'attachment').replace(/[\\/]/g, '_');
        path = directory + '/share-' + util.generateRandomUUID() + '-' + name;
        const target = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
        try { await fs.copyFile(file.fd, target.fd); } finally { await fs.close(target); }
        attachment = { path, name, mimeType: attachmentMime(name), size };
      } finally { await fs.close(file); }
      const payload = encodeShareHandoff('', [], [attachment]);
      const received = decodeShareHandoff(payload);
      if (received) {
        const manifest = await fs.open(directory + '/intake-' + received.intakeId + '.json', fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
        try { await fs.write(manifest.fd, payload); } finally { await fs.close(manifest); }
        this.receive(received);
      }
    } catch (error) {
      if (path) fs.unlink(path).catch((_error: Error): void => {});
      const failed = decodeShareHandoff(encodeShareHandoff('', [], [], [(error as Error).message]));
      if (failed) this.receive(failed);
    }
  }
  receive(value: XopcIncomingShare): void {
    value.intakeId = value.intakeId || util.generateRandomUUID(); value.createdAt = value.createdAt || Date.now();
    if (this.queue.some((item: XopcIncomingShare): boolean => item.intakeId === value.intakeId)) return;
    this.queue.push(value); this.queuedCount = this.queue.length;
    this.pending = this.queue[0];
    void this.persist();
    this.revision++;
  }
  dismiss(): void {
    this.cleanupPendingFiles();
    this.queue.shift(); this.pending = this.queue[0]; this.queuedCount = this.queue.length; void this.persist(); this.saveMutationId = ''; this.attachmentMutationIds = []; this.revision++;
  }
  targetChat(conversationId: string, text: string): void {
    this.chatConversationId = conversationId; this.chatText = text; this.chatRevision++;
  }
  consumeChat(conversationId: string): string {
    if (!conversationId || conversationId !== this.chatConversationId) return '';
    const value = this.chatText; this.chatConversationId = ''; this.chatText = ''; return value;
  }
  async save(): Promise<string> {
    const value = this.pending; if (!value) return '';
    if (this.captureIntakeId !== value.intakeId || !this.saveMutationId) {
      this.captureIntakeId = value.intakeId || '';
      this.saveMutationId = util.generateRandomUUID();
      this.attachmentMutationIds = (value.attachments ?? []).map((_item: XopcIncomingShareAttachment): string => util.generateRandomUUID());
    }
    const originalMarkdown = noteText(value);
    const body: XopcShareCaptureBody = { text: originalMarkdown, channel: 'share', platform: 'harmonyos' };
    const result = JSON.parse(await gatewaySession.request('/api/notes/quick-capture', 'POST', JSON.stringify(body),
      this.saveMutationId)) as XopcShareCaptureResult;
    if (!result.note?.id) throw new Error('INVALID_CAPTURE_RESPONSE');
    const noteId = result.note.id;
    const refs: string[] = [];
    const incoming = value.attachments ?? [];
    for (let index = 0; index < incoming.length; index++) {
      const item = incoming[index];
      const attachment: XopcNoteAttachment = await this.media.uploadFile(noteId, item.path, item.name, item.mimeType,
        this.attachmentMutationIds[index]);
      const escaped = attachment.fileName.replace(/([\\\[\]])/g, '\\$1');
      const target = 'xopc-attachment://notes/' + encodeURIComponent(noteId) + '/' + encodeURIComponent(attachment.id);
      refs.push(attachment.type === 'image' ? '![' + escaped + '](' + target + ')' : '[' + escaped + '](' + target + ')');
    }
    if (refs.length) {
      const note = await this.notes.detail(noteId);
      const draft: XopcNoteDraft = {
        noteId, title: note.title ?? '', markdown: originalMarkdown.replace(/\s+$/, '') + '\n\n' + refs.join('\n\n'),
        baseRevision: note.remoteVersion ?? 1, localVersion: (note.localVersion ?? 1) + 1,
        updatedAt: Date.now(), syncState: 'dirty', mutationId: util.generateRandomUUID()
      };
      await this.notes.sync(draft);
    }
    this.dismiss(); return noteId;
  }

  private cleanupPendingFiles(): void { if (this.pending) this.cleanupShareFiles(this.pending); }
  private cleanupShareFiles(incoming: XopcIncomingShare): void {
    const id = incoming.intakeId;
    if (id && this.directory) fs.unlink(this.directory + '/intake-' + id + '.json').catch((_error: Error): void => {});
    for (const item of incoming.attachments ?? []) { fs.unlink(item.path).catch((_error: Error): void => {}); }
  }
}

export const shareIntake: XopcShareIntake = new XopcShareIntake();
