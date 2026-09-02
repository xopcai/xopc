import { ArrowUpRight, AudioLines, Mic } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { normalizeVoiceSettings } from '@/features/settings/voice-config-api';

const PROVIDER_NAMES: Record<string, string> = {
  'xopc-cloud': 'XOPC Cloud',
  'xopc-local': 'XOPC Local',
  alibaba: 'Alibaba Cloud',
  edge: 'Microsoft Edge',
  groq: 'Groq',
  minimax: 'MiniMax',
  openai: 'OpenAI',
  'tts-local-cli': 'Local TTS',
};

function configuredValue(
  providers: Record<string, Record<string, unknown>> | undefined,
  provider: string,
  key: 'model' | 'voice',
): string | undefined {
  const value = providers?.[provider]?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

function VoiceStatus({
  icon: Icon,
  label,
  enabled,
  details,
  zh,
}: {
  icon: typeof Mic;
  label: string;
  enabled: boolean;
  details?: string;
  zh: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-edge bg-surface-panel p-4">
      <div className="rounded-lg bg-accent/10 p-2 text-accent"><Icon className="size-4" aria-hidden /></div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-fg">{label}</h3>
          <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-fg-muted">
            {enabled ? (zh ? '已启用' : 'On') : (zh ? '已关闭' : 'Off')}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-fg-muted">
          {enabled ? details : (zh ? '不处理语音' : 'Voice processing is disabled')}
        </p>
      </div>
    </div>
  );
}

export function AgentDefaultsVoiceSummary({ zh }: { zh: boolean }) {
  const { data, error, isLoading } = useGatewayConfigSwr(true);
  const config = data?.payload?.config;
  const voice = config === undefined ? undefined : normalizeVoiceSettings(config);

  const sttModel = voice
    ? configuredValue(voice.stt.providers, voice.stt.provider, 'model')
    : undefined;
  const ttsModel = voice
    ? configuredValue(voice.tts.providers, voice.tts.provider, 'model')
    : undefined;
  const ttsVoice = voice
    ? configuredValue(voice.tts.providers, voice.tts.provider, 'voice')
    : undefined;
  const sttDetails = voice
    ? [providerName(voice.stt.provider), sttModel].filter(Boolean).join(' · ')
    : undefined;
  const ttsDetails = voice
    ? [providerName(voice.tts.provider), ttsModel, ttsVoice].filter(Boolean).join(' · ')
    : undefined;

  return (
    <section className="rounded-2xl border border-edge bg-surface-base p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">{zh ? '语音能力' : 'Voice capabilities'}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {zh ? 'STT 和 TTS 由所有 Agent 共用，在全局语音设置中统一管理。' : 'STT and TTS are shared by every agent and managed in global voice settings.'}
          </p>
        </div>
        <Button asChild variant="secondary" className="shrink-0">
          <Link to="/settings/capabilities/voice">
            {zh ? '管理语音设置' : 'Manage voice settings'}
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>

      {isLoading || !voice ? (
        error ? (
          <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {zh ? '暂时无法读取语音配置。' : 'Voice settings could not be loaded.'}
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        )
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <VoiceStatus
            icon={Mic}
            label={zh ? '语音转文字（STT）' : 'Speech to text (STT)'}
            enabled={voice.stt.enabled}
            details={sttDetails}
            zh={zh}
          />
          <VoiceStatus
            icon={AudioLines}
            label={zh ? '文字转语音（TTS）' : 'Text to speech (TTS)'}
            enabled={voice.tts.enabled}
            details={ttsDetails}
            zh={zh}
          />
        </div>
      )}
    </section>
  );
}
