import { useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { ComposerModelConfigControl } from '@/features/chat/model/composer-model-config-control';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { SessionManager } from '@/features/chat/session/session-manager';
import { patchSessionAgentConfigView } from '@/features/chat/session/patch-session-agent-config-view';
import { messages } from '@/i18n/messages';

const manager = new SessionManager();

export function PersonalModelSetting({ conversationId, zh, onSaved }: {
  conversationId: string; zh: boolean; onSaved: () => Promise<void>;
}) {
  const session = useChatSessionStore(state => state.sessions[conversationId]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void manager.loadSessionAgentConfig(conversationId).then(config => {
      if (active) patchSessionAgentConfigView(conversationId, config);
    }).catch(cause => { if (active) setError(String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId]);
  const busy = Boolean(session?.sending || session?.streaming || session?.modelConfigSaving);
  async function save(model: string, thinkingLevel?: string) {
    useChatSessionStore.getState().patchSessionMeta(conversationId, { modelConfigSaving: true });
    try {
      const config = await manager.patchSessionAgentConfig(conversationId, {
        model, thinkingLevel, configVersion: session?.configVersion,
      });
      patchSessionAgentConfigView(conversationId, config);
      await onSaved();
    } catch (cause) {
      const config = await manager.loadSessionAgentConfig(conversationId).catch(() => null);
      if (config) patchSessionAgentConfigView(conversationId, config);
      throw cause;
    } finally {
      useChatSessionStore.getState().patchSessionMeta(conversationId, { modelConfigSaving: false });
    }
  }
  return <section>
    <h3 className="mb-3 text-sm font-medium text-fg">{zh ? '对话模型与思考强度' : 'Conversation model and thinking'}</h3>
    {loading ? <Skeleton className="h-9 w-full" /> : <ComposerModelConfigControl
      chat={messages(zh ? 'zh' : 'en').chat} sessionModel={session?.model ?? ''}
      thinkingLevel={session?.thinkingLevel ?? 'off'} modelDisabled={busy} thinkingDisabled={busy}
      onModelChange={save} onThinkingChange={level => save(session?.model ?? '', level)} />}
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </section>;
}
