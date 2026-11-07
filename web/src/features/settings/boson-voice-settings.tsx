import { useId, useLayoutEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { HIGGS_REALTIME_VOICES, type HiggsVoice } from '@xopcai/realtime-protocol/voice';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { SecretInput } from '@/components/ui/secret-input';
import { Skeleton } from '@/components/ui/skeleton';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { closeCapabilitySettings } from '@/features/settings/models-hub/open-capability-settings';
import { useRealtimeVoice } from '@/features/voice/realtime/use-realtime-voice';
import { messages } from '@/i18n/messages';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

import { bosonVoiceSettingsUrl, fetchBosonVoiceSettings, revealBosonApiKey, saveBosonVoiceSettings } from './voice-config-api';

export function BosonVoiceSettings({ disabled = false }: { disabled?: boolean }) {
  const language = useLocaleStore(state => state.language);
  const zh = language === 'zh';
  const { data, error: loadError, mutate } = useSWR(apiUrl(bosonVoiceSettingsUrl), fetchBosonVoiceSettings);
  const [key, setKey] = useState('');
  const [keyRevision, setKeyRevision] = useState(0);
  const keyId = useId();
  // The capability dialog retains its subtree when closed. Mask the key on each activation.
  useLayoutEffect(() => { setKeyRevision(value => value + 1); }, []);
  const [selectedVoice, setSelectedVoice] = useState<HiggsVoice>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [played, setPlayed] = useState(false);
  const test = useRealtimeVoice({
    disabled: disabled || busy,
    chat: messages(language).chat,
    onTranscript: () => {},
    onTestAudioPlayed: () => setPlayed(true),
  });
  const testing = test.phase !== 'idle' && test.phase !== 'error';
  const voice = selectedVoice ?? data?.voice ?? 'default';
  const storedKey = data?.credentialSource === 'global';

  async function revealKey() {
    try {
      return await revealBosonApiKey();
    } catch (cause) {
      if (cause instanceof Error && 'status' in cause && cause.status === 404) {
        throw new Error(zh ? '当前 Gateway 版本不支持查看密钥。请更新并重启 Gateway。'
          : 'Update and restart the Gateway to view or copy the saved key.');
      }
      throw cause;
    }
  }

  async function save(change: Parameters<typeof saveBosonVoiceSettings>[0]) {
    if (busy || testing) return;
    setBusy(true);
    setError('');
    try {
      await mutate(await saveBosonVoiceSettings(change), { revalidate: false });
      if ('apiKey' in change) {
        setKey('');
        setKeyRevision(value => value + 1);
        setPlayed(false);
        test.cancelVoiceInput();
      }
      await revalidateGatewayConfig();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <section className="@container space-y-3 rounded-xl border border-edge bg-surface-panel p-4" aria-label="Boson AI">
    <h3 className="text-sm font-semibold">Boson AI · Higgs Realtime</h3>
    {!data && !loadError ? <Skeleton className="h-24 w-full" /> : null}
    {loadError ? <div role="alert" className="text-sm text-danger">
      {zh ? '无法读取 Boson 设置。' : 'Could not load Boson settings.'}
      <Button variant="ghost" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button>
    </div> : null}
    {data && <>
      <fieldset disabled={disabled || busy || testing} className="space-y-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <label htmlFor={keyId} className="text-sm font-medium text-fg">Boson API Key</label>
            <p role="status" className="text-xs text-fg-muted">
              {data.credentialSource === 'env' ? (zh ? '已从环境读取 BOSON_API_KEY' : 'Using BOSON_API_KEY from the environment')
                : data.credentialSource ? (zh ? '已保存 API Key' : 'API key saved')
                  : (zh ? '尚未连接' : 'Connection needed')}
            </p>
          </div>
          <div className="grid items-start gap-2 @min-[32rem]:grid-cols-[minmax(0,1fr)_auto]">
            <SecretInput key={`${storedKey}:${keyRevision}`} id={keyId} value={key || (storedKey ? '••••••••••••' : '')}
              onChange={value => setKey(value.replace(/^•+/u, ''))} autoComplete="new-password" inputClassName="min-h-11"
              labels={{ show: zh ? '显示密钥' : 'Show key', hide: zh ? '隐藏密钥' : 'Hide key',
                copy: zh ? '复制密钥' : 'Copy key', copied: zh ? '已复制' : 'Copied' }}
              reveal={storedKey ? revealKey : undefined} allowUnrevealedCopy
              loadFailedLabel={zh ? '无法查看已保存的密钥。' : 'Could not load the saved key.'}
              notInConfigFile={zh ? '当前没有已保存的密钥。' : 'There is no saved key.'} />
            <div className="flex flex-wrap items-center gap-2">
              <Button className="min-h-11" variant="secondary" type="button" disabled={!key.trim()} onClick={() => void save({ apiKey: key })}>
                {busy ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存密钥' : 'Save key')}
              </Button>
              {storedKey && <Button className="min-h-11" type="button" variant="ghost" onClick={() => void save({ apiKey: null })}>
                {zh ? '移除已保存密钥' : 'Remove saved key'}
              </Button>}
            </div>
          </div>
        </div>
        <div className="space-y-1 text-sm">
          <span>{zh ? 'Higgs 默认音色' : 'Default Higgs voice'}</span>
          <Select aria-label={zh ? 'Higgs 默认音色' : 'Default Higgs voice'} value={voice} onChange={event => { setSelectedVoice(event.target.value as HiggsVoice); setPlayed(false); test.cancelVoiceInput(); }}>
            {HIGGS_REALTIME_VOICES.map(id => <SelectOption key={id} value={id}>{id === 'default' ? (zh ? '模型默认' : 'Model default') : id}</SelectOption>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={voice === data.voice || !data.credentialSource}
            onClick={() => void save({ voice })}>{zh ? '保存音色' : 'Save voice'}</Button>
          <span className="text-sm text-fg-muted">{data.defaultForNatural
            ? (zh ? '当前全局自然语音模型' : 'Current global natural voice model')
            : (zh ? '在上方选择全局自然语音模型' : 'Choose the global natural voice model above')}</span>
        </div>
      </fieldset>
      <div className="space-y-2 border-t border-edge pt-3">
        <p className="text-sm text-fg-muted">{zh ? '测试时请说一句中文，听到回复后可以插话。音频由 Boson 处理，测试内容仅在当前面板显示，可能产生用量。' : 'Say a sentence and try interrupting the reply. Boson processes the audio. Test content stays in this panel and may incur usage.'}</p>
        <div className="flex flex-wrap items-center gap-2">
          {testing
            ? <Button type="button" variant="secondary" onClick={test.cancelVoiceInput}>{zh ? '结束测试' : 'End test'}</Button>
            : <Button type="button" variant="secondary" disabled={disabled || busy || !data.credentialSource} onClick={() => {
              test.cancelVoiceInput();
              setPlayed(false);
              setError('');
              void test.startHiggsTest(voice);
            }}>{zh ? '测试通话' : 'Test call'}</Button>}
          {data.credentialSource && !disabled && !busy && !testing && <Link className="px-2 text-sm text-accent-fg hover:underline" to="/personal" onClick={closeCapabilitySettings}>{zh ? '打开 Ada' : 'Open Ada'}</Link>}
        </div>
        {testing && <p role="status" className="text-sm text-fg-muted">
          {test.phase !== 'recording' ? (zh ? '正在连接测试通话…' : 'Connecting test call…')
            : test.responsePhase === 'speaking' ? (zh ? '正在播放，可以插话' : 'Playing reply. You can interrupt.')
              : (zh ? '麦克风已开启，请说话' : 'Microphone on. Say something.')}
        </p>}
        {played && <p role="status" className="text-sm text-success">{zh ? '测试通过，已播放回复' : 'Test passed. Reply played.'}</p>}
        {test.finalTranscript && <p className="text-sm text-fg">{zh ? '转写 · ' : 'Transcript · '}{test.finalTranscript}</p>}
        {test.responseText && <p className="text-sm text-fg">{zh ? '回复 · ' : 'Reply · '}{test.responseText}</p>}
      </div>
    </>}
    {(error || test.error) && <p role="alert" className="text-sm text-danger">{error || test.error}</p>}
  </section>;
}
