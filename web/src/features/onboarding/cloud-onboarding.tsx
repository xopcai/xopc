import { Cloud, X } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { OAuthProviderConnect } from '@/features/settings/models-hub/oauth-provider-connect';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

type CloudOnboardingStatus = { status: 'unseen' | 'dismissed'; hasGrant: boolean };
const KEY = '/api/models/cloud-onboarding';

async function fetchStatus(): Promise<CloudOnboardingStatus> {
  const response = await apiFetch(apiUrl(KEY));
  if (!response.ok) throw new Error(`Cloud onboarding: ${response.status}`);
  const body = await response.json() as { payload: CloudOnboardingStatus };
  return body.payload;
}

export function useCloudOnboarding(enabled: boolean) {
  const { data, error, mutate } = useSWR(enabled ? KEY : null, fetchStatus, { revalidateOnFocus: false });
  return {
    ready: Boolean(data) && !error,
    pending: data?.status === 'unseen' && !data.hasGrant,
    refresh: () => mutate(),
    dismiss: async () => {
      const response = await apiFetch(apiUrl(KEY), { method: 'PUT' });
      if (!response.ok) throw new Error(`Cloud onboarding dismissal: ${response.status}`);
      await mutate({ status: 'dismissed', hasGrant: false }, { revalidate: false });
    },
  };
}

export function CloudOnboardingCard({ context, onDismiss, onConnected }: {
  context: 'chat' | 'personal' | 'general';
  onDismiss: () => void;
  onConnected: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const [connected, setConnected] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const [catalogIssue, setCatalogIssue] = useState(false);
  const heading = context === 'chat'
    ? (zh ? '为对话连接更多模型' : 'Connect more models for chat')
    : context === 'personal'
      ? (zh ? '为个人 Agent 一次配好模型' : 'Set up models for your personal agent')
      : (zh ? '连接 XOPC Cloud，省去逐个配置模型' : 'Connect XOPC Cloud to simplify model setup');
  const description = context === 'chat'
    ? (zh
      ? '连接 XOPC Cloud 后，此账号可用的聊天、图片和语音模型会自动同步。你可以继续使用当前聊天模型，稍后再切换。'
      : 'Connect XOPC Cloud to sync the chat, image, and voice models available to your account. You can keep using your current chat model and switch later.')
    : context === 'personal'
      ? (zh
        ? '连接一次即可为个人 Agent 准备此账号可用的聊天、图片和语音模型。已有模型和明确设置不会改变。'
        : 'Connect once to make the chat, image, and voice models available to your personal agent. Your current model and explicit settings stay in place.')
      : (zh
        ? '授权后会同步此账号可用的聊天、图片和语音等模型。已有的默认聊天模型及明确设置保持不变，之后可自行切换。'
        : 'Authorize once to sync the chat, image, and voice models available to your account. Your current default chat model and explicit settings stay in place.');
  const completeAuthorization = async () => {
    setConnected(true);
    try {
      const response = await apiFetch(apiUrl('/api/models/catalog'));
      if (!response.ok) throw new Error('Readiness unavailable');
      const body = await response.json() as { payload: {
        sources: { 'xopc-cloud'?: { models: Array<{ kind: string; availability: string; input: string[] }> } };
      } };
      const models = body.payload.sources['xopc-cloud']?.models.filter((model) => model.availability === 'available') ?? [];
      const kinds = new Set(models.map((model) => model.kind));
      setAvailable([
        ...(kinds.has('language') ? [zh ? '聊天' : 'chat'] : []),
        ...(models.some((model) => model.kind === 'language' && model.input.includes('image')) ? [zh ? '视觉理解' : 'vision'] : []),
        ...(kinds.has('image') ? [zh ? '图片生成' : 'image generation'] : []),
        ...(kinds.has('stt') ? [zh ? '语音识别' : 'speech recognition'] : []),
        ...(kinds.has('tts') ? [zh ? '语音合成' : 'speech synthesis'] : []),
      ]);
      setCatalogIssue(models.length === 0);
    } catch {
      setCatalogIssue(true);
    }
  };
  return (
    <div className="p-5 sm:p-6">
      <div className="w-full">
        <div className="flex items-start justify-between gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"><Cloud className="size-6" aria-hidden /></span>
          <Button type="button" variant="ghost" aria-label={connected ? (zh ? '继续' : 'Continue') : (zh ? '暂时不用' : 'Maybe later')} onClick={connected ? onConnected : onDismiss}><X className="size-4" /></Button>
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-fg">{connected ? (zh ? 'XOPC Cloud 已连接' : 'XOPC Cloud is connected') : heading}</h1>
        <p className="mt-3 text-sm leading-6 text-fg-muted">
          {connected
            ? catalogIssue
              ? (zh ? '授权已完成，模型目录暂不可用。稍后可在模型设置中刷新。' : 'Authorization completed, but the model catalog is temporarily unavailable. Refresh it later in model settings.')
              : (zh ? `已同步可用能力：${available.join('、') || '模型目录'}。你可以稍后在模型设置中选择默认模型。` : `Available capabilities: ${available.join(', ') || 'model catalog'}. You can choose a default model later in model settings.`)
            : description}
        </p>
        {connected ? (
          <Button type="button" variant="primary" className="mt-7" onClick={onConnected}>{zh ? '继续聊天' : 'Continue to chat'}</Button>
        ) : (
          <>
            <div className="mt-7"><OAuthProviderConnect providerId="xopc-cloud" displayName="XOPC Cloud" connected={false} onConnected={() => void completeAuthorization()} /></div>
            <Button type="button" variant="ghost" className="mt-5" onClick={onDismiss}>{zh ? '暂时不用，继续使用现有模型' : 'Maybe later, keep using my current model'}</Button>
          </>
        )}
      </div>
    </div>
  );
}
