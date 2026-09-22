import { XopcIncomingShare } from '../model/share';
import { gatewaySession } from './gatewaySession';

interface XopcShareCaptureBody { text: string; channel: string; platform: string; }
interface XopcShareCaptureResult { note?: XopcShareCaptureNote; }
interface XopcShareCaptureNote { id: string; }

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

export function incomingShare(title: string, values: string[]): XopcIncomingShare | undefined {
  const cleaned = values.map((value: string): string => value.trim()).filter((value: string): boolean => !!value);
  const label = title.trim();
  const raw = cleaned.join('\n').trim();
  const content = label && cleaned.length === 1 && URL_ONLY.test(cleaned[0]) ? label + '\n' + cleaned[0] : raw;
  if (content.length < 3 || content.length > 100000 || !/[A-Za-z0-9\u3400-\u9FFF]/.test(content)
    || /^[\d\s-]{3,8}$/.test(content) || (content.length <= 160 && OTP.test(content))) return undefined;
  const sensitive = SECRET_ASSIGNMENT.test(content) || JWT.test(content) || EMAIL.test(content) || PHONE.test(content)
    || CARD.test(content) || SECRET.test(content);
  SECRET_ASSIGNMENT.lastIndex = 0; JWT.lastIndex = 0; EMAIL.lastIndex = 0; PHONE.lastIndex = 0; CARD.lastIndex = 0; SECRET.lastIndex = 0;
  const preview = sensitive ? content.replace(JWT, '[token hidden]').replace(EMAIL, '[email hidden]').replace(CARD, '[number hidden]')
    .replace(PHONE, '[phone hidden]').replace(SECRET_ASSIGNMENT, '$1$2$3[hidden]$4').replace(SECRET, 'Bearer [hidden]') : content;
  JWT.lastIndex = 0; EMAIL.lastIndex = 0; PHONE.lastIndex = 0; CARD.lastIndex = 0; SECRET.lastIndex = 0; SECRET_ASSIGNMENT.lastIndex = 0;
  const kind = kindOf(content);
  return { title: title.trim(), content, chatPrompt: promptFor(kind, content), kind, preview: preview.slice(0, 1200), sensitive };
}

@ObservedV2
export class XopcShareIntake {
  @Trace pending?: XopcIncomingShare;
  @Trace revision: number = 0;
  @Trace chatText: string = '';
  @Trace chatRevision: number = 0;
  @Trace chatConversationId: string = '';

  receive(value: XopcIncomingShare): void { this.pending = value; this.revision++; }
  dismiss(): void { this.pending = undefined; this.revision++; }
  targetChat(conversationId: string, text: string): void {
    this.chatConversationId = conversationId; this.chatText = text; this.chatRevision++;
  }
  consumeChat(conversationId: string): string {
    if (!conversationId || conversationId !== this.chatConversationId) return '';
    const value = this.chatText; this.chatConversationId = ''; this.chatText = ''; return value;
  }
  async save(): Promise<string> {
    const value = this.pending; if (!value) return '';
    const body: XopcShareCaptureBody = { text: noteText(value), channel: 'share', platform: 'harmonyos' };
    const result = JSON.parse(await gatewaySession.request('/api/notes/quick-capture', 'POST', JSON.stringify(body))) as XopcShareCaptureResult;
    if (!result.note?.id) throw new Error('INVALID_CAPTURE_RESPONSE');
    this.dismiss(); return result.note.id;
  }
}

export const shareIntake: XopcShareIntake = new XopcShareIntake();
