import * as Dialog from '@radix-ui/react-dialog';
import { LockKeyhole, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { AddPhoneDialog } from './phone/add-phone-dialog';
import { PhoneModelConnection } from './phone/phone-model-connection';

type Setup = {
  id: string;
  conversationId: string;
  revision: number;
  stale?: boolean;
  state: string;
  source?: string;
  resumeObjective?: string;
  summary?: string;
  missingSteps?: string[];
  readiness?: {
    model: { ref?: string };
    devices: Array<{ id: string; name: string; enabled: boolean }>;
    localDiscovery: Array<{ serial?: string; name: string; state: string }>;
  };
  endpoints?: Array<{ endpointId: string; displayName: string }>;
};

const MANAGED_SCENES = new Set(['models', 'web_search', 'voice', 'channels', 'computer']);
const LEGACY_SCENES = new Set(['browser', 'phone']);

/** Owner-authenticated manual steps only. Saving never grants a new task or a broader device scope. */
export function SetupInteractionPage() {
  const { scene, setupId } = useParams();
  const [params] = useSearchParams();
  const conversationId = params.get('conversationId') ?? '';
  const step = params.get('step');
  const zh = useLocaleStore(state => state.language) === 'zh';
  const navigate = useNavigate();
  const [connectionAdded, setConnectionAdded] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [providerId, setProviderId] = useState('openai');
  const [secretValue, setSecretValue] = useState('');
  const [secondaryValue, setSecondaryValue] = useState('');
  const [voiceCapability, setVoiceCapability] = useState<'tts' | 'stt'>('tts');
  const [channelId, setChannelId] = useState<'telegram' | 'weixin'>('telegram');
  const returning = useRef(false);

  useEffect(() => {
    returning.current = false;
    setConnectionAdded(false);
    setSelected('');
    setSecretValue('');
    setSecondaryValue('');
    setError('');
  }, [scene, setupId, conversationId]);

  const isManaged = MANAGED_SCENES.has(scene ?? '');
  const isLegacy = LEGACY_SCENES.has(scene ?? '');
  const valid = (isManaged || isLegacy) && Boolean(setupId && conversationId);
  const endpointUrl = isManaged ? apiUrl(`/api/setup/${scene}`) : apiUrl(`/api/${scene}/setup`);

  const request = async (action: string, extra: Record<string, unknown> = {}) =>
    (await fetchJson<{ payload: Setup }>(endpointUrl, {
      method: 'POST',
      body: JSON.stringify({ conversationId, setupId, action, ...extra }),
    })).payload;

  const { data, error: loadError, mutate } = useSWR(
    valid ? ['setup-interaction', scene, setupId, conversationId] : null,
    () => request('get'),
    { refreshInterval: isLegacy ? 2000 : 0 },
  );

  const current = (value: Setup) =>
    value.id === setupId
    && value.conversationId === conversationId
    && !value.stale
    && !['cancelled', 'completed'].includes(value.state);

  const close = () => {
    if (!busy && !returning.current) {
      navigate(`/chat/${encodeURIComponent(conversationId)}`, { replace: true });
    }
  };

  const resume = async (selection = '', overrideObjective?: string) => {
    if (returning.current) return;
    returning.current = true;
    setBusy(true);
    setError('');
    try {
      const fresh = await request('recheck');
      if (!current(fresh)) throw new Error('changed');
      if (scene === 'browser' && !fresh.endpoints?.some(endpoint => endpoint.endpointId === selection)) {
        throw new Error('not-connected');
      }
      const objective = overrideObjective ?? fresh.resumeObjective;
      const sceneLabel = scene === 'browser'
        ? 'Browser Use'
        : scene === 'phone'
          ? 'Phone Use'
          : scene === 'models'
            ? (zh ? '模型与密钥' : 'Models')
            : scene === 'web_search'
              ? (zh ? '联网搜索' : 'Web Search')
              : scene === 'voice'
                ? (zh ? '语音服务' : 'Voice')
                : scene === 'channels'
                  ? (zh ? '消息渠道' : 'Channels')
                  : (zh ? '电脑控制' : 'Computer Use');
      const approval = scene === 'browser'
        ? (zh ? '允许仅在独立测试页进行读取、点击和示例输入的有界验收，完成后关闭并确认释放，不操作业务网页。' : 'I authorize bounded read, click and sample input on the isolated test page only; close and confirm release afterwards. Do not operate business pages.')
        : '';
      const objectiveSuffix = objective
        ? (zh ? `验证通过后请继续完成原任务：${objective}` : ` After verification passes, resume the original request: ${objective}`)
        : '';
      const draft = zh
        ? `人工配置步骤已完成。${approval}请先重新检查并验证本对话 ${sceneLabel} 的配置进度，继续此前已授权的流程。${selection ? `本次选择：${selection}。` : ''}${objectiveSuffix}不要扩大设备、权限或任务范围；取消或过期的授权不能恢复。`
        : `The manual setup step is complete. ${approval} Recheck and verify this conversation’s ${sceneLabel} setup before continuing the previously authorized flow.${selection ? ` Selected target: ${selection}.` : ''}${objectiveSuffix} Do not widen device, permission or task scope, or revive cancelled or expired grants.`;
      const query = new URLSearchParams({ draft, autoSend: '1' });
      navigate(`/chat/${encodeURIComponent(conversationId)}?${query}`, { replace: true });
    } catch {
      returning.current = false;
      setError(zh ? '尚未检测到有效配置，或原请求已变更。请检查后重试。' : 'The setup is not ready or the original request changed. Check and try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitManagedSecret = async () => {
    if (!data) return;
    setBusy(true);
    setError('');
    try {
      let payload: Record<string, unknown> = {};
      if (scene === 'models') {
        if (!secretValue.trim()) throw new Error(zh ? '请输入 API Key。' : 'API key is required.');
        payload = { providerId, apiKey: secretValue.trim() };
      } else if (scene === 'web_search') {
        const searchType = selected || 'tavily';
        if (searchType === 'searxng') {
          if (!secondaryValue.trim()) throw new Error(zh ? '请输入 SearXNG URL。' : 'SearXNG URL is required.');
          payload = { providerType: 'searxng', url: secondaryValue.trim() };
        } else {
          if (!secretValue.trim()) throw new Error(zh ? '请输入搜索 API Key。' : 'Search API key is required.');
          payload = { providerType: searchType, apiKey: secretValue.trim() };
        }
      } else if (scene === 'voice') {
        payload = {
          capability: voiceCapability,
          provider: providerId,
          ...(secretValue.trim() ? { apiKey: secretValue.trim() } : {}),
          ...(secondaryValue.trim() ? { voice: secondaryValue.trim() } : {}),
        };
      } else if (scene === 'channels') {
        payload = {
          channel: channelId,
          ...(secretValue.trim() ? { botToken: secretValue.trim() } : {}),
        };
      } else if (scene === 'computer') {
        payload = { enabled: true, permissionsConfirmed: true };
      }

      const updated = await request('submit_secret', { payload });
      await mutate(updated, false);
      setBusy(false);
      await resume('', updated.resumeObjective);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : (zh ? '保存配置失败。' : 'Failed to save configuration.'));
    }
  };

  const active = data && current(data);
  if (active && scene === 'phone' && step === 'connection' && data.source === 'aliyun' && !connectionAdded) {
    return (
      <AddPhoneDialog
        zh={zh}
        initialMethod="aliyun"
        onClose={close}
        onSelect={() => { setError(zh ? '请在原对话确认本机设备。' : 'Confirm the local device in the original chat.'); }}
        onAdded={() => { setConnectionAdded(true); void resume(); }}
      />
    );
  }

  const title = scene === 'browser'
    ? (zh ? '完成浏览器连接' : 'Finish browser connection')
    : scene === 'phone'
      ? (step === 'model' ? (zh ? '配置手机模型' : 'Set up Phone model') : (zh ? '完成手机连接' : 'Finish phone connection'))
      : scene === 'models'
        ? (zh ? '配置模型供应商密钥' : 'Configure model provider')
        : scene === 'web_search'
          ? (zh ? '配置联网搜索' : 'Configure web search')
          : scene === 'voice'
            ? (zh ? '配置语音服务' : 'Configure voice service')
            : scene === 'channels'
              ? (zh ? '配置消息渠道' : 'Configure channel')
              : (zh ? '开启电脑控制并确认权限' : 'Enable Computer Use');

  return (
    <main className="h-full bg-surface-base">
      <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim backdrop-blur-sm" />
          <Dialog.Content
            onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}
            className="fixed inset-x-0 bottom-0 z-[70] flex h-[min(36rem,calc(100dvh-1rem))] flex-col overflow-hidden rounded-t-3xl border border-edge bg-surface-overlay text-fg sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[30rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
          >
            <header className="relative shrink-0 px-6 pb-5 pt-8 text-center">
              <Button variant="ghost" className="absolute right-2 top-2 size-11 p-0" disabled={busy} aria-label={zh ? '暂时关闭' : 'Close for now'} onClick={close}>
                <X className="size-4" aria-hidden />
              </Button>
              <LockKeyhole className="mx-auto mb-4 size-6 text-accent-fg" aria-hidden />
              <Dialog.Title ref={titleRef} tabIndex={-1} className="text-xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-3 text-sm text-fg-muted">
                {zh ? '只完成需要你操作的一步，密钥不会进入对话。' : 'Complete only the step that needs you. Secrets never enter the conversation.'}
              </Dialog.Description>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-5">
              {!data && !loadError && valid ? (
                <Skeleton className="h-32 w-full rounded-xl" />
              ) : !active ? (
                <p role="alert" className="text-sm text-fg-muted">
                  {zh ? '此配置请求已失效或无法读取，请返回原对话重新检查。' : 'This setup is no longer valid or could not be loaded. Return to the original chat to recheck.'}
                </p>
              ) : scene === 'phone' && step === 'model' ? (
                <PhoneModelConnection
                  zh={zh}
                  value={data.readiness?.model.ref ?? ''}
                  disabled={busy}
                  onSave={async modelRef => {
                    setBusy(true);
                    try {
                      await request('set_model', { modelRef, expectedRevision: data.revision, replaceExisting: true });
                      await mutate();
                    } finally {
                      setBusy(false);
                    }
                    await resume();
                  }}
                />
              ) : isLegacy ? (
                <>
                  <p className="text-sm leading-relaxed text-fg-muted">
                    {scene === 'browser'
                      ? (zh ? '在 Gateway 所在电脑的 Chrome 加载已准备的扩展，并接受你同意的原生权限。随后选择这个 Chrome，系统会在独立测试页验证读取、点击和输入，再释放控制。' : 'Load the prepared extension in Chrome on the Gateway computer and accept the native permissions you agree to. Select that Chrome to verify read, click and fill on an isolated test page, then release control.')
                      : (zh ? '连接并解锁 Gateway 所在电脑上的测试手机，按手机提示确认 USB 调试。返回后会重新检查设备，只继续此前授权的设置页测试。' : 'Connect and unlock the test phone on the Gateway computer and confirm USB debugging on the phone. The device will be rechecked before the previously authorized Settings test continues.')}
                  </p>
                  {scene === 'browser' ? (
                    <label className="block space-y-2 text-sm">
                      <span>{zh ? '用于验收的 Chrome' : 'Chrome to verify'}</span>
                      <Select aria-label={zh ? '用于验收的 Chrome' : 'Chrome to verify'} value={selected} onChange={event => setSelected(event.target.value)}>
                        <SelectOption value="">{zh ? '选择 Chrome' : 'Choose Chrome'}</SelectOption>
                        {data.endpoints?.map(endpoint => (
                          <SelectOption key={endpoint.endpointId} value={endpoint.endpointId}>{endpoint.displayName}</SelectOption>
                        ))}
                      </Select>
                    </label>
                  ) : null}
                </>
              ) : (
                <div className="space-y-4">
                  {data.resumeObjective ? (
                    <div className="rounded-xl border border-edge bg-surface-subtle/60 px-3.5 py-2.5 text-xs text-fg-muted">
                      <span className="font-medium text-fg">{zh ? '完成后将继续任务：' : 'Will resume: '}</span>
                      {data.resumeObjective}
                    </div>
                  ) : null}

                  {scene === 'models' ? (
                    <>
                      <label className="block space-y-1.5 text-sm">
                        <span>{zh ? '模型供应商' : 'Provider'}</span>
                        <Select value={providerId} onChange={e => setProviderId(e.target.value)}>
                          <SelectOption value="openai">OpenAI</SelectOption>
                          <SelectOption value="anthropic">Anthropic</SelectOption>
                          <SelectOption value="google">Google Gemini</SelectOption>
                          <SelectOption value="openrouter">OpenRouter</SelectOption>
                          <SelectOption value="deepseek">DeepSeek</SelectOption>
                          <SelectOption value="dashscope">DashScope</SelectOption>
                        </Select>
                      </label>
                      <label className="block space-y-1.5 text-sm">
                        <span>API Key</span>
                        <input
                          type="password"
                          autoComplete="off"
                          value={secretValue}
                          onChange={e => setSecretValue(e.target.value)}
                          placeholder="sk-..."
                          className="w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                      </label>
                    </>
                  ) : null}

                  {scene === 'web_search' ? (
                    <>
                      <label className="block space-y-1.5 text-sm">
                        <span>{zh ? '搜索供应商' : 'Search provider'}</span>
                        <Select value={selected || 'tavily'} onChange={e => setSelected(e.target.value)}>
                          <SelectOption value="tavily">Tavily</SelectOption>
                          <SelectOption value="brave">Brave Search</SelectOption>
                          <SelectOption value="bing">Bing</SelectOption>
                          <SelectOption value="deepseek">DeepSeek</SelectOption>
                          <SelectOption value="searxng">SearXNG</SelectOption>
                        </Select>
                      </label>
                      {(selected || 'tavily') === 'searxng' ? (
                        <label className="block space-y-1.5 text-sm">
                          <span>SearXNG URL</span>
                          <input
                            type="url"
                            value={secondaryValue}
                            onChange={e => setSecondaryValue(e.target.value)}
                            placeholder="https://search.example.com"
                            className="w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none"
                          />
                        </label>
                      ) : (
                        <label className="block space-y-1.5 text-sm">
                          <span>API Key</span>
                          <input
                            type="password"
                            autoComplete="off"
                            value={secretValue}
                            onChange={e => setSecretValue(e.target.value)}
                            placeholder="tvly-..."
                            className="w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none"
                          />
                        </label>
                      )}
                    </>
                  ) : null}

                  {scene === 'voice' ? (
                    <>
                      <label className="block space-y-1.5 text-sm">
                        <span>{zh ? '语音能力' : 'Capability'}</span>
                        <Select value={voiceCapability} onChange={e => setVoiceCapability(e.target.value as 'tts' | 'stt')}>
                          <SelectOption value="tts">{zh ? '语音合成 (TTS)' : 'Text-to-Speech (TTS)'}</SelectOption>
                          <SelectOption value="stt">{zh ? '语音转文字 (STT)' : 'Speech-to-Text (STT)'}</SelectOption>
                        </Select>
                      </label>
                      <label className="block space-y-1.5 text-sm">
                        <span>{zh ? '语音供应商' : 'Voice provider'}</span>
                        <Select value={providerId} onChange={e => setProviderId(e.target.value)}>
                          <SelectOption value="edge">Edge (免费免密钥)</SelectOption>
                          <SelectOption value="openai">OpenAI</SelectOption>
                          <SelectOption value="alibaba">DashScope / Alibaba</SelectOption>
                          <SelectOption value="minimax">MiniMax</SelectOption>
                        </Select>
                      </label>
                      {providerId !== 'edge' ? (
                        <label className="block space-y-1.5 text-sm">
                          <span>{zh ? 'API Key（可选，如已全局配置可留空）' : 'API Key (optional if already configured)'}</span>
                          <input
                            type="password"
                            autoComplete="off"
                            value={secretValue}
                            onChange={e => setSecretValue(e.target.value)}
                            className="w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none"
                          />
                        </label>
                      ) : null}
                      {voiceCapability === 'tts' ? (
                        <label className="block space-y-1.5 text-sm">
                          <span>{zh ? '默认音色（可选）' : 'Default voice (optional)'}</span>
                          <input
                            type="text"
                            value={secondaryValue}
                            onChange={e => setSecondaryValue(e.target.value)}
                            placeholder="zh-CN-XiaoxiaoNeural"
                            className="w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none"
                          />
                        </label>
                      ) : null}
                    </>
                  ) : null}

                  {scene === 'channels' ? (
                    <>
                      <label className="block space-y-1.5 text-sm">
                        <span>{zh ? '消息渠道' : 'Channel'}</span>
                        <Select value={channelId} onChange={e => setChannelId(e.target.value as 'telegram' | 'weixin')}>
                          <SelectOption value="telegram">Telegram</SelectOption>
                          <SelectOption value="weixin">{zh ? '微信 (Weixin)' : 'Weixin'}</SelectOption>
                        </Select>
                      </label>
                      {channelId === 'telegram' ? (
                        <label className="block space-y-1.5 text-sm">
                          <span>Bot Token</span>
                          <input
                            type="password"
                            autoComplete="off"
                            value={secretValue}
                            onChange={e => setSecretValue(e.target.value)}
                            placeholder="123456:ABC-DEF..."
                            className="w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none"
                          />
                        </label>
                      ) : (
                        <p className="text-sm text-fg-muted">
                          {zh ? '启用微信通道后，请在设置页完成扫码配对。' : 'Enable Weixin channel, then complete pairing in Channel settings.'}
                        </p>
                      )}
                    </>
                  ) : null}

                  {scene === 'computer' ? (
                    <p className="text-sm leading-relaxed text-fg-muted">
                      {zh
                        ? '请在系统设置中确认已授予 xopc「辅助功能」和「录屏」权限，然后点击下方按钮启用 Computer Use 并返回原对话继续。'
                        : 'Confirm that xopc has Accessibility and Screen Recording permissions in system settings, then enable Computer Use and return to the original conversation.'}
                    </p>
                  ) : null}
                </div>
              )}

              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            </div>

            <footer className="shrink-0 space-y-2 border-t border-edge p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {active && isLegacy && !(scene === 'phone' && step === 'model') ? (
                <Button variant="primary" className="min-h-12 w-full" disabled={busy || (scene === 'browser' && !selected)} onClick={() => { void resume(selected); }}>
                  {scene === 'browser' ? (zh ? '核对并开始安全验收' : 'Recheck and start safe test') : (zh ? '检查并继续原对话' : 'Recheck and continue in chat')}
                </Button>
              ) : null}
              {active && isManaged ? (
                <Button variant="primary" className="min-h-12 w-full" disabled={busy} onClick={() => { void submitManagedSecret(); }}>
                  {zh ? '保存并返回原对话继续' : 'Save and continue in chat'}
                </Button>
              ) : null}
              <Button variant="ghost" className="min-h-11 w-full" disabled={busy} onClick={close}>
                {zh ? '返回原对话' : 'Return to original chat'}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
