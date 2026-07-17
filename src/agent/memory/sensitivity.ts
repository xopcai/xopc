import type { MemorySensitivity } from './types.js';

export function inferMemorySensitivity(content: string): MemorySensitivity {
  if (
    /\b(api[_-]?key|access[_-]?key|token|password|secret|credential|private[_-]?key|bearer)\b/i.test(content)
    || /密钥|密码|令牌|私钥/.test(content)
    || /\b(?:sk|gh[opsu]|xox[abprs])-[a-z0-9_-]{8,}\b/i.test(content)
    || /\bAKIA[A-Z0-9]{12,}\b/.test(content)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)
  ) return 'secret';
  if (
    /\b(ssn|social security|bank account|credit card|medical record)\b/i.test(content)
    || /身份证|银行卡|信用卡|医疗记录/.test(content)
  ) return 'regulated';
  return /家庭|住址|生日|健康|关系|family|address|birthday|health/i.test(content)
    ? 'personal'
    : 'normal';
}

export function redactSensitiveMemoryText(content: string): string {
  return content
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(api[_-]?key|access[_-]?key|token|password|secret|credential|private[_-]?key|bearer)\b\s*[:=]?\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/(密钥|密码|令牌|私钥)\s*[：:=]?\s*[^\s，；]+/g, '$1=[REDACTED]')
    .replace(/\b(?:sk|gh[opsu]|xox[abprs])-[a-z0-9_-]{8,}\b/gi, '[REDACTED TOKEN]')
    .replace(/\bAKIA[A-Z0-9]{12,}\b/g, '[REDACTED ACCESS KEY]');
}
