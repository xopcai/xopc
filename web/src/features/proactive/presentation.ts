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

export function delegationState(sub: Delegation, zh: boolean, card?: ProactiveCard): string {
  if (sub.completedAt) return zh ? '这件事已结束' : 'This work has ended';
  if (!sub.effectiveEnabled) return zh ? '已暂停，恢复后继续跟进' : 'Paused until you resume it';
  if (sub.checking) return zh ? '助理正在查看最新情况' : 'Your assistant is reviewing the latest context';
  if (card?.decision) return zh ? '有一项决定等你处理' : 'A decision needs your attention';
  if (card?.artifact) return zh ? '助理准备好了新内容' : 'Your assistant prepared something new';
  if (card) return zh ? '有一项变化值得你看' : 'A change is worth your attention';
  return zh ? '已记住，等待相关变化' : 'Remembered and waiting for a relevant change';
}

export function delegationNextTrigger(sub: Delegation, zh: boolean): string {
  if (sub.completedAt) return zh ? '不会再跟进' : 'No more follow-up';
  if (!sub.effectiveEnabled) return zh ? '恢复后继续' : 'Continues when resumed';
  if (sub.scopeKind === 'project') return zh ? '项目出现重要变化时回来' : 'Returns when the project meaningfully changes';
  if (sub.scenarioKey === 'meeting_preparation') return zh ? '相关会议临近或资料变化时回来' : 'Returns when a meeting approaches or its context changes';
  return zh ? '相关沟通需要下一步时回来' : 'Returns when the conversation needs a next step';
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
