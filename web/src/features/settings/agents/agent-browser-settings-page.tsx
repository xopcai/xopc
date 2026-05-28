import { useMemo } from 'react';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsBrowserPanel } from './agent-defaults-panels/browser-panel';
import { AgentDefaultsRouteLayout } from './agent-defaults-route-layout';
import { useAgentDefaultsForm } from './use-agent-defaults-form';

export function AgentBrowserSettingsPage() {
  const language = useLocaleStore((state) => state.language);
  const messageBundle = messages(language);
  const agentSettings = messageBundle.agentSettings;
  const chatMessages = messageBundle.chat;
  const viewModel = useAgentDefaultsForm(agentSettings);

  const panelProps = useMemo(() => {
    if (!viewModel.form) {
      return null;
    }
    return {
      form: viewModel.form,
      update: viewModel.update,
      a: agentSettings,
      chat: chatMessages,
    };
  }, [viewModel.form, viewModel.update, agentSettings, chatMessages]);

  return (
    <AgentDefaultsRouteLayout
      sectionId="agent-browser"
      intro={agentSettings.routeIntro.browser}
      vm={viewModel}
    >
      {panelProps ? <AgentDefaultsBrowserPanel {...panelProps} /> : null}
    </AgentDefaultsRouteLayout>
  );
}
