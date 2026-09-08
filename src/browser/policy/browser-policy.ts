import type { BrowserActionInput, BrowserNode, BrowserRiskLevel } from '@xopcai/browser-control-contract';

const DESTRUCTIVE_PATTERN = /\b(delete|remove|erase|destroy|cancel subscription|关闭账户|删除|移除|注销)\b/i;
const EXTERNAL_EFFECT_PATTERN = /\b(send|submit|publish|post|pay|buy|purchase|confirm|发送|提交|发布|支付|购买|确认)\b/i;

export function classifyBrowserRisk(input: BrowserActionInput, target?: BrowserNode): BrowserRiskLevel {
  if (input.action === 'upload') return 'sensitive';
  if (input.action === 'fill') {
    if (target?.states.includes('sensitive')) return 'sensitive';
    if (input.submit) return 'external_effect';
    return 'draft';
  }
  if (input.action === 'press') {
    if (input.key === 'Enter' && target?.states.includes('submit')) return 'external_effect';
    return 'draft';
  }
  if (input.action === 'select' || input.action === 'scroll') {
    return 'draft';
  }
  if (input.action !== 'click') return 'read';
  const label = `${target?.role ?? ''} ${target?.name ?? ''} ${target?.description ?? ''}`;
  if (DESTRUCTIVE_PATTERN.test(label)) return 'destructive';
  if (target?.states.includes('submit')) return 'external_effect';
  if (EXTERNAL_EFFECT_PATTERN.test(label)) return 'external_effect';
  return 'draft';
}

export function browserRiskNeedsApproval(risk: BrowserRiskLevel): boolean {
  return risk === 'external_effect' || risk === 'destructive' || risk === 'sensitive';
}
