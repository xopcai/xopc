import useSWR from 'swr';

import { automationApi, type AutomationResultDeliveryRecord } from './automation-api';

export function deliveryFeedback(items: AutomationResultDeliveryRecord[], language: 'zh' | 'en'): string | null {
  const zh = language === 'zh';
  if (items.some(item => item.status === 'dead_letter')) return zh ? '结果已保存，部分通知未能送达。可通过对话排查后重新发送，无需重跑任务。' : 'Your result is saved, but a notification could not be sent. Ask in chat to retry delivery without rerunning the task.';
  if (items.some(item => item.status === 'retrying')) return zh ? '结果已保存，通知正在重试。' : 'Your result is saved. Notification delivery is retrying.';
  if (items.some(item => item.status === 'pending' || item.status === 'delivering')) return zh ? '结果已保存，正在发送通知。' : 'Your result is saved. Sending notifications.';
  return null;
}

export function AutomationDeliveryStatus({ runId, language }: { runId: string; language: 'zh' | 'en' }) {
  const { data, error } = useSWR(['automation-result-deliveries', runId], () => automationApi.deliveries({ runId }), { refreshInterval: 5000 });
  const feedback = data ? deliveryFeedback(data.items, language) : null;
  return feedback ? <p role="status" className="mt-2 text-xs leading-5 text-fg-muted">{feedback}</p> : error ? <p className="mt-2 text-xs text-fg-muted">{language === 'zh' ? '结果已保存，暂时无法确认通知状态。' : 'Your result is saved. Notification status is temporarily unavailable.'}</p> : null;
}
