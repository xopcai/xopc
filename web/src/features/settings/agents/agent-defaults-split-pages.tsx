import { useMemo } from 'react';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import type { AgentDefaultsPanelProps } from './agent-defaults-panel-props';
import { AgentDefaultsBasicsPanel } from './agent-defaults-panels/basics-panel';
import { AgentDefaultsBrowserPanel } from './agent-defaults-panels/browser-panel';
import { AgentDefaultsCapabilitiesPanel } from './agent-defaults-panels/capabilities-panel';
import { AgentDefaultsContextPanel } from './agent-defaults-panels/context-panel';
import { AgentDefaultsExpertPanel } from './agent-defaults-panels/expert-panel';
import { AgentDefaultsMemoryPanel } from './agent-defaults-panels/memory-panel';
import { AgentDefaultsSkillsAllowlistPanel } from './agent-defaults-panels/skills-allowlist-panel';
import { AgentDefaultsSystemPromptPanel } from './agent-defaults-panels/system-prompt-panel';
import { AgentDefaultsWorkspacePanel } from './agent-defaults-panels/workspace-panel';
import { GoalsConfigSection } from '@/features/settings/goals-config-section';
import { SkillsMarketplaceConfigSection } from '@/features/skills/skills-marketplace-config-section';

import { AgentDefaultsRouteLayout } from './agent-defaults-route-layout';
import { useAgentDefaultsForm } from './use-agent-defaults-form';

function useAgentDefaultsPageModel(): {
  vm: ReturnType<typeof useAgentDefaultsForm>;
  pp: AgentDefaultsPanelProps | null;
  a: ReturnType<typeof messages>['agentSettings'];
} {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.agentSettings;
  const chat = m.chat;
  const vm = useAgentDefaultsForm(a);
  const pp = useMemo(() => {
    if (!vm.form) return null;
    return { form: vm.form, update: vm.update, a, chat };
  }, [vm.form, vm.update, a, chat]);
  return { vm, pp, a };
}

export function AgentChatDefaultsPage() {
  const { vm, pp, a } = useAgentDefaultsPageModel();

  return (
    <AgentDefaultsRouteLayout sectionId="agent-chat" intro={a.routeIntro.chat} vm={vm}>
      {pp ? <AgentDefaultsBasicsPanel {...pp} /> : null}
    </AgentDefaultsRouteLayout>
  );
}

export function AgentWorkspaceDefaultsPage() {
  const { vm, pp, a } = useAgentDefaultsPageModel();

  return (
    <AgentDefaultsRouteLayout sectionId="agent-workspace" intro={a.routeIntro.workspace} vm={vm}>
      {pp ? <AgentDefaultsWorkspacePanel {...pp} /> : null}
    </AgentDefaultsRouteLayout>
  );
}

export function AgentBrowserDefaultsPage() {
  const { vm, pp, a } = useAgentDefaultsPageModel();

  return (
    <AgentDefaultsRouteLayout sectionId="agent-browser" intro={a.routeIntro.browser} vm={vm}>
      {pp ? <AgentDefaultsBrowserPanel {...pp} /> : null}
    </AgentDefaultsRouteLayout>
  );
}

export function AgentRuntimeDefaultsPage() {
  const { vm, pp, a } = useAgentDefaultsPageModel();

  return (
    <AgentDefaultsRouteLayout sectionId="agent-runtime" intro={a.routeIntro.runtime} vm={vm}>
      {pp ? (
        <div className="flex flex-col gap-8">
          <GoalsConfigSection hasToken={vm.hasToken} />
          <AgentDefaultsContextPanel {...pp} />
          <AgentDefaultsMemoryPanel {...pp} />
        </div>
      ) : null}
    </AgentDefaultsRouteLayout>
  );
}

export function AgentToolsDefaultsPage() {
  const { vm, pp, a } = useAgentDefaultsPageModel();

  return (
    <AgentDefaultsRouteLayout sectionId="agent-tools" intro={a.routeIntro.tools} vm={vm}>
      {pp ? (
        <div className="flex flex-col gap-8">
          <AgentDefaultsCapabilitiesPanel {...pp} />
          <AgentDefaultsExpertPanel {...pp} />
        </div>
      ) : null}
    </AgentDefaultsRouteLayout>
  );
}

export function AgentSkillsDefaultsPage() {
  const { vm, pp, a } = useAgentDefaultsPageModel();

  return (
    <AgentDefaultsRouteLayout sectionId="agent-skills" intro={a.routeIntro.skills} vm={vm}>
      {pp ? (
        <div className="flex flex-col gap-8">
          <SkillsMarketplaceConfigSection hasToken={vm.hasToken} />
          <AgentDefaultsSkillsAllowlistPanel {...pp} />
        </div>
      ) : null}
    </AgentDefaultsRouteLayout>
  );
}

export function AgentSystemPromptDefaultsPage() {
  const { vm, pp, a } = useAgentDefaultsPageModel();

  return (
    <AgentDefaultsRouteLayout sectionId="agent-system-prompt" intro={a.routeIntro.systemPrompt} vm={vm}>
      {pp ? <AgentDefaultsSystemPromptPanel {...pp} /> : null}
    </AgentDefaultsRouteLayout>
  );
}
