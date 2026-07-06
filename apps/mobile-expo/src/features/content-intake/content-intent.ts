import { parseCaptureIntent } from '../notes/capture-parser';
import type { NoteKind } from '../../query/notes';

export type ContentIntakeSource = 'clipboard' | 'share';
export type ContentIntakeType = 'url' | 'code' | 'todo' | 'longText' | 'text';

export type ContentIntakeActionKey =
  | 'saveLink'
  | 'saveCode'
  | 'saveChecklist'
  | 'saveToNote'
  | 'summarizeLink'
  | 'explainCode'
  | 'organizeChecklist'
  | 'summarizeText'
  | 'exploreInChat';

export type ContentIntakeIntent = {
  type: ContentIntakeType;
  noteKind: NoteKind;
  saveActionKey: ContentIntakeActionKey;
  chatActionKey: ContentIntakeActionKey;
  chatPrompt: string;
  previewText: string;
  isSensitive: boolean;
};

const URL_PATTERN = /^https?:\/\/[^\s<>)"']+$/i;
const ANY_URL_PATTERN = /https?:\/\/[^\s<>)"']+/i;
const FENCED_CODE_PATTERN = /^```[\s\S]*```$/;
const CODE_PATTERN =
  /\b(import|export|function|class|interface|type|const|let|var|return|async|await|SELECT|FROM|WHERE)\b|[{};]\s*$/m;
const SECRET_PATTERN =
  /\b(password|passwd|secret|token|api[_-]?key|bearer\s+[a-z0-9._~+/-]{16,}|sk-[a-z0-9_-]{16,})\b/i;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)(["']?)[^\n,;]+(["']?)/i;
const SECRET_ASSIGNMENT_REPLACE_PATTERN =
  /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)(["']?)[^\n,;]+(["']?)/gi;
const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{12,}\b/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?\d[\d -]{8,}\d)\b/g;
const CARD_NUMBER_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const PERSONAL_INFO_PATTERN = new RegExp(
  `${EMAIL_PATTERN.source}|${PHONE_PATTERN.source}|${CARD_NUMBER_PATTERN.source}`,
  'i',
);
const OTP_MESSAGE_PATTERN =
  /(?:验证码|校验码|动态码|verification code|security code|auth code|login code|one-time|otp)[\s\S]{0,80}\b\d{4,8}\b/i;
const LOW_VALUE_PATTERN = /^[\d\s-]{3,8}$/;
const SIGNAL_PATTERN = /[\p{L}\p{N}]/u;
const LONG_TEXT_THRESHOLD = 420;

export function shouldOfferContentIntake(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  if (!SIGNAL_PATTERN.test(trimmed)) return false;
  if (LOW_VALUE_PATTERN.test(trimmed)) return false;
  if (trimmed.length <= 160 && OTP_MESSAGE_PATTERN.test(trimmed)) return false;
  return true;
}

export function analyzeIntakeContent(text: string): ContentIntakeIntent {
  const trimmed = text.trim();
  const captureIntent = parseCaptureIntent(trimmed);
  const isSensitive =
    SECRET_ASSIGNMENT_PATTERN.test(trimmed) ||
    SECRET_PATTERN.test(trimmed) ||
    JWT_PATTERN.test(trimmed) ||
    PERSONAL_INFO_PATTERN.test(trimmed);
  const type = classifyContent(trimmed, captureIntent.kind);

  if (type === 'url') {
    return {
      type,
      noteKind: 'bookmark',
      saveActionKey: 'saveLink',
      chatActionKey: 'summarizeLink',
      chatPrompt: `请阅读并总结这个链接，提炼关键内容、风险和下一步建议：\n\n${trimmed}`,
      previewText: maskSensitiveText(trimmed, isSensitive),
      isSensitive,
    };
  }

  if (type === 'code') {
    return {
      type,
      noteKind: 'thought',
      saveActionKey: 'saveCode',
      chatActionKey: 'explainCode',
      chatPrompt: `请解释这段代码的作用，并指出可以改进或需要注意的地方：\n\n${trimmed}`,
      previewText: maskSensitiveText(trimmed, isSensitive),
      isSensitive,
    };
  }

  if (type === 'todo') {
    return {
      type,
      noteKind: 'todo',
      saveActionKey: 'saveChecklist',
      chatActionKey: 'organizeChecklist',
      chatPrompt: `请把下面的清单整理成清晰的行动计划，按优先级和下一步输出：\n\n${trimmed}`,
      previewText: maskSensitiveText(trimmed, isSensitive),
      isSensitive,
    };
  }

  if (type === 'longText') {
    return {
      type,
      noteKind: captureIntent.kind,
      saveActionKey: 'saveToNote',
      chatActionKey: 'summarizeText',
      chatPrompt: `请总结下面内容，提炼核心观点、待办事项和可追问的问题：\n\n${trimmed}`,
      previewText: maskSensitiveText(trimmed, isSensitive),
      isSensitive,
    };
  }

  return {
    type,
    noteKind: captureIntent.kind,
    saveActionKey: 'saveToNote',
    chatActionKey: 'exploreInChat',
    chatPrompt: `请围绕下面内容展开分析，给出有价值的观察和下一步建议：\n\n${trimmed}`,
    previewText: maskSensitiveText(trimmed, isSensitive),
    isSensitive,
  };
}

function classifyContent(text: string, noteKind: NoteKind): ContentIntakeType {
  if (URL_PATTERN.test(text)) return 'url';
  if (noteKind === 'todo') return 'todo';
  if (looksLikeCode(text)) return 'code';
  if (text.length >= LONG_TEXT_THRESHOLD || text.split('\n').length >= 8) return 'longText';
  if (ANY_URL_PATTERN.test(text) && text.split('\n').length <= 2) return 'url';
  return 'text';
}

function looksLikeCode(text: string): boolean {
  const trimmed = text.trim();
  if (FENCED_CODE_PATTERN.test(trimmed)) return true;
  if (CODE_PATTERN.test(trimmed) && trimmed.split('\n').length >= 2) return true;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function maskSensitiveText(text: string, isSensitive: boolean): string {
  if (!isSensitive) return text;
  return text
    .replace(JWT_PATTERN, '[token hidden]')
    .replace(EMAIL_PATTERN, '[email hidden]')
    .replace(CARD_NUMBER_PATTERN, '[number hidden]')
    .replace(PHONE_PATTERN, '[phone hidden]')
    .replace(SECRET_ASSIGNMENT_REPLACE_PATTERN, (_match, key: string, separator: string, openQuote: string) =>
      `${key}${separator}${openQuote}[hidden]${openQuote}`,
    )
    .replace(SECRET_PATTERN, (match) => (match.toLowerCase().startsWith('bearer') ? 'Bearer [hidden]' : match));
}
