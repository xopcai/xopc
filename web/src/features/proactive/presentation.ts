import type { ProactiveCard } from '@xopcai/gateway-contract';

import type { Delegation, MailFollowUp } from './api';
import { localizedTemplate } from './copy';

export type DelegationBucket = 'active' | 'paused' | 'completed';

export function delegationTitle(sub: Delegation, zh: boolean): string {
  return sub.project?.name ?? localizedTemplate(sub.scenarioKey, { title: sub.scenarioKey.replaceAll('_', ' '), description: '' }, zh ? 'zh' : 'en').title;
}

export function delegationBucket(sub: Delegation): DelegationBucket {
  if (sub.completedAt) return 'completed';
  return sub.effectiveEnabled ? 'active' : 'paused';
}

export function mailFollowUpBucket(follow: MailFollowUp): DelegationBucket {
  if (follow.status === 'completed') return 'completed';
  return follow.status === 'watching' && follow.enabled ? 'active' : 'paused';
}

export function delegationState(sub: Delegation, zh: boolean): string {
  if (sub.completedAt) return zh ? '这件事已结束' : 'This work has ended';
  if (!sub.effectiveEnabled) return zh ? '已暂停，恢复后继续跟进' : 'Paused until you resume it';
  if (sub.pending) return zh ? '正在核对最新情况' : 'Checking the latest context';
  if (sub.latestRun?.error) return zh ? '最近一次核对未完成' : 'The latest check did not finish';
  const outcome = sub.latestRun?.reason ?? sub.latestRun?.status;
  if (['no_insight', 'succeeded_no_insight', 'below_threshold', 'low_value', 'unchanged', 'routine'].includes(outcome ?? '')) return zh ? '已核对，暂无需要你处理的变化' : 'Checked; nothing needs your attention';
  if (['insight', 'succeeded_with_insight'].includes(outcome ?? '')) return zh ? '已准备一项新内容' : 'A new result is ready';
  if (outcome === 'approval_required') return zh ? '有一项决定等你处理' : 'A decision needs your attention';
  if (sub.latestRun) return zh ? '已完成最近一次核对' : 'The latest check is complete';
  return zh ? '已记住，等待相关变化' : 'Remembered and waiting for a relevant change';
}

export function delegationNextTrigger(sub: Delegation, zh: boolean): string {
  if (sub.completedAt) return zh ? '不会再跟进' : 'No more follow-up';
  if (!sub.effectiveEnabled) return zh ? '恢复后继续' : 'Continues when resumed';
  if (sub.schedule?.nextDueAt) return `${zh ? '下次核对' : 'Next check'} ${formatAssistantDate(sub.schedule.nextDueAt, zh)}`;
  return zh ? '相关资料变化时继续' : 'Continues when related context changes';
}

export function latestCardFor(cards: ProactiveCard[], subscriptionId: string): ProactiveCard | undefined {
  return cards.filter(card => card.subscriptionId === subscriptionId).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

export function latestCardSummary(card: ProactiveCard | undefined, zh: boolean): string {
  if (!card) return zh ? '还没有需要交付的新成果' : 'No new result needs delivery yet';
  if (card.decision) return `${zh ? '等你决定' : 'Waiting for your decision'}：${card.title}`;
  if (card.artifact) return `${zh ? '最新成果' : 'Latest result'}：${card.artifact.title}`;
  return `${zh ? '最新变化' : 'Latest update'}：${card.title}`;
}

export function mailFollowUpState(follow: MailFollowUp, zh: boolean): string {
  if (follow.status === 'completed') return zh ? '这件事已结束' : 'This work has ended';
  if (follow.status === 'paused' || !follow.enabled) return zh ? '已暂停，恢复后继续跟进' : 'Paused until you resume it';
  if (!follow.sourceAvailable) return zh ? '需要重新连接邮箱' : 'Reconnect the email account';
  if (follow.syncFailed) return zh ? '最近一次邮箱同步未完成' : 'The latest email sync did not finish';
  if (follow.latestDirection === 'sent') return zh ? '已同步发件，继续等待回复' : 'Sent message found; waiting for a reply';
  return zh ? '正在等待回复或约定时间' : 'Waiting for a reply or the agreed time';
}

export function formatAssistantDate(value: string, zh: boolean): string {
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US');
}

export function runProgressLabel(value: string, zh: boolean): string {
  if (['no_insight', 'succeeded_no_insight', 'below_threshold', 'low_value', 'unchanged', 'routine'].includes(value)) return zh ? '核对完成，没有需要你处理的变化' : 'Checked; nothing needed your attention';
  if (['insight', 'succeeded_with_insight'].includes(value)) return zh ? '准备了一项新内容' : 'Prepared a new result';
  if (value === 'approval_required') return zh ? '发现一项需要你决定的事' : 'Found a decision that needs you';
  if (value === 'failed' || value === 'retryable') return zh ? '这次核对没有完成' : 'This check did not finish';
  if (value === 'running' || value === 'pending') return zh ? '正在核对最新情况' : 'Checking the latest context';
  return zh ? '完成了一次核对' : 'Completed a check';
}
