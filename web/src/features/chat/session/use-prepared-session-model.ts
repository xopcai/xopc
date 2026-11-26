import { chooseModelThinking, modelPreferenceForAgent } from '@xopcai/gateway-contract';
import { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { fetchAgentRuntimeModelsCached, fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import { fetchGatewayAgentEffectiveConfig } from '@/features/settings/agents-admin-api';
import type { ExternalAgentKind } from '@/features/settings/types/agent-gateway';
import { useGatewayStore } from '@/stores/gateway-store';

import { DEFAULT_THINKING } from './chat-session-defaults';
import { readNewSessionPreferences, rememberAgentModel } from './new-session-preferences';
import type { ProjectSessionPreparation } from './use-chat-session-init';

type Selection = { model: string; thinkingLevel: string };

/** Resolve a concrete selection before a project chat allocates its session or environment. */
export function usePreparedSessionModel(
  preparation: ProjectSessionPreparation | null,
  externalRuntime?: ExternalAgentKind,
) {
  const token = useGatewayStore((state) => state.conversationId);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const [edited, setEdited] = useState<{ preparation: ProjectSessionPreparation; selection: Selection } | null>(null);
  const { data, error } = useSWR(
    preparation ? ['prepared-session-model', baseUrl, token, preparation.create, externalRuntime ?? 'builtin'] : null,
    async () => {
      const preference = modelPreferenceForAgent(readNewSessionPreferences(), preparation!.agentId);
      if (externalRuntime) {
        const runtimePayload = await fetchAgentRuntimeModelsCached(preparation!.agentId);
        const models = runtimePayload.models;
        const preferredRef = preference?.modelRef?.trim();
        const selected = (preferredRef ? models.find((model) => model.id === preferredRef) : undefined)
          ?? models.find((model) => model.id === runtimePayload.defaultModel)
          ?? models[0];
        const modelId = selected?.id ?? runtimePayload.defaultModel ?? externalRuntime;
        return {
          models,
          selection: {
            model: modelId,
            thinkingLevel: selected?.thinking
              ? chooseModelThinking(selected.thinking, preference?.thinkingLevel, preference?.thinkingByModel?.[modelId])
              : preference?.thinkingLevel ?? DEFAULT_THINKING,
          },
        };
      }
      const [models, modelRef] = await Promise.all([
        fetchConfiguredModelsCached(),
        preference?.modelRef ?? fetchGatewayAgentEffectiveConfig(preparation!.agentId)
          .then((result) => result.config.models.chat.primary),
      ]);
      const matches = models.filter((model) => model.id === modelRef || model.id.endsWith(`/${modelRef}`));
      const selected = models.find((model) => model.id === modelRef) ?? (matches.length === 1 ? matches[0] : undefined);
      return {
        models,
        selection: {
          model: selected?.id ?? modelRef,
          thinkingLevel: selected?.thinking
            ? chooseModelThinking(selected.thinking, preference?.thinkingLevel, preference?.thinkingByModel?.[selected.id])
            : preference?.thinkingLevel ?? DEFAULT_THINKING,
        },
      };
    },
    { revalidateOnFocus: false },
  );
  const externalFallback: Selection | undefined = externalRuntime ? { model: externalRuntime, thinkingLevel: DEFAULT_THINKING } : undefined;
  const selection = (edited?.preparation === preparation ? edited?.selection : data?.selection) ?? externalFallback;
  const selected = data?.models.find((model) => model.id === selection?.model);
  const ready = Boolean(externalRuntime) || Boolean(selection?.model && selected);
  const explicitlySelected = edited?.preparation === preparation;
  const latest = useRef({ preparation, selection, ready, explicitlySelected });
  latest.current = { preparation, selection, ready, explicitlySelected };

  // Keep preparation identity stable when editing the model, so the environment choice survives.
  const prepared = useMemo<ProjectSessionPreparation | null>(() => preparation && ({
    ...preparation,
    create: async (mode, _config, onOpened) => {
      const current = latest.current;
      if (current.preparation !== preparation || !current.ready || !current.selection) {
        throw new Error('Model configuration is not ready');
      }
      const config = current.selection;
      const key = await preparation.create(mode, config, onOpened);
      if (current.explicitlySelected) {
        rememberAgentModel(preparation.agentId, { modelRef: config.model, thinkingLevel: config.thinkingLevel });
      }
      return key;
    },
  } satisfies ProjectSessionPreparation), [preparation]);

  const change = async (modelId: string, level?: string) => {
    if (!preparation || !data) throw new Error('Model configuration is not ready');
    const model = data.models.find((item) => item.id === modelId);
    if (!model) throw new Error('Model is unavailable');
    const remembered = modelPreferenceForAgent(readNewSessionPreferences(), preparation.agentId)?.thinkingByModel?.[modelId];
    const thinkingLevel = model.thinking
      ? chooseModelThinking(model.thinking, level ?? selection?.thinkingLevel, level === undefined ? remembered : undefined)
      : level ?? selection?.thinkingLevel ?? DEFAULT_THINKING;
    setEdited({ preparation, selection: { model: modelId, thinkingLevel } });
  };

  return {
    preparation: prepared,
    model: selection?.model ?? '',
    thinkingLevel: selection?.thinkingLevel ?? DEFAULT_THINKING,
    modelSupportsThinking: Boolean(selected?.reasoning || (selected?.thinking && selected.thinking.mode !== 'none')),
    ready,
    error,
    onModelChange: (model: string, level?: string) => change(model, level),
    onThinkingChange: (level: string) => change(selection?.model ?? '', level),
  };
}
