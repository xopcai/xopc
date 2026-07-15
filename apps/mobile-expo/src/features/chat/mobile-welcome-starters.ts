import {
  buildWelcomeSpotlight,
  type WelcomeSpotlightCopy,
  type WelcomeSuggestionAgent,
  type WelcomeSuggestionContext,
} from '@xopcai/gateway-contract';

import type { MessageBundle } from '../../i18n/messages';
import type { ChatAgentOption } from '../../query/agents';

export type MobileWelcomeStarter = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  icon: string;
};

export type MobileWelcomeModel = {
  headline: string;
  tagline: string;
  starters: MobileWelcomeStarter[];
};

function agentForWelcome(agent: ChatAgentOption | undefined, fallbackId: string): WelcomeSuggestionAgent {
  return {
    id: agent?.id ?? fallbackId,
    name: agent?.name,
    description: agent?.description,
    skills: [
      ...(agent?.skills.effectiveAllowlist ?? []),
      ...(agent?.skills.entry ?? []),
      ...(agent?.skills.defaults ?? []),
    ],
  };
}

function starterId(categoryId: string, index: number): string {
  return `${categoryId}:${index}`;
}

export function buildMobileWelcomeModel({
  messages,
  agent,
  agentId,
  effectiveWorkspacePath,
}: {
  messages: MessageBundle;
  agent?: ChatAgentOption;
  agentId: string;
  effectiveWorkspacePath?: string | null;
}): MobileWelcomeModel {
  const path = effectiveWorkspacePath?.trim();
  const context: WelcomeSuggestionContext = path
    ? { kind: 'workingDirectory', path }
    : { kind: 'empty' };
  const spotlight = buildWelcomeSpotlight(
    context,
    messages.chat.welcomeSpotlight as WelcomeSpotlightCopy,
    agentForWelcome(agent, agentId || 'main'),
    {
      affinity: context.kind === 'empty' ? { 'explore-ai-news:0': 35 } : undefined,
      explorationSeed: new Date().toISOString().slice(0, 10),
    },
  );
  const starters = spotlight.categories.flatMap((category) => {
    const scenario = category.scenarios[0];
    if (!scenario?.prompt.trim()) return [];
    return [{
      id: scenario.id ?? starterId(category.id, 0),
      title: category.title,
      description: category.description,
      prompt: scenario.prompt,
      icon: category.icon,
    }];
  });
  return {
    headline: spotlight.headline,
    tagline: spotlight.tagline,
    starters: starters.slice(0, 3),
  };
}
