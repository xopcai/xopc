import { useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';

import {
  getChannels,
  getSessionChatIds,
  type ChannelStatus,
  type SessionChatId,
} from '@/features/settings/channel-recipient-api';
import {
  patchGatewayBindings,
  type GatewayAgentRow,
  type GatewayConfigBinding,
} from '@/features/settings/agents-admin-api';
import { useAsyncResource } from '@/lib/use-async-resource';

import type { AgentPanel } from '../utils';
import { buildNewBindingMatch } from '../utils';

export function useAgentsChannelBindings(options: {
  panel: AgentPanel;
  hasToken: boolean;
  bindingsFromConfig: GatewayConfigBinding[];
  gatewayCfgLoading: boolean;
  selected: GatewayAgentRow | null;
  saveErrorMessage: string;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    panel,
    hasToken,
    bindingsFromConfig,
    gatewayCfgLoading,
    selected,
    saveErrorMessage,
    setBusy,
    setError,
  } = options;

  const bindingsDirtyRef = useRef(false);
  const [localBindings, setLocalBindings] = useState<GatewayConfigBinding[] | null>(null);

  const trackedBindingsRef = useRef(bindingsFromConfig);
  if (
    panel === 'channels' &&
    hasToken &&
    !bindingsDirtyRef.current &&
    trackedBindingsRef.current !== bindingsFromConfig
  ) {
    trackedBindingsRef.current = bindingsFromConfig;
    setLocalBindings(bindingsFromConfig);
  }

  const allBindings = localBindings ?? bindingsFromConfig;

  const channelsEnabled = panel === 'channels' && hasToken;
  const channelsResource = useAsyncResource(
    () => getChannels(),
    [panel, hasToken],
    { enabled: channelsEnabled, initial: [] as ChannelStatus[], errorData: [] },
  );
  const bindChannelStatuses = channelsResource.data;
  const bindChannelsLoading = channelsResource.loading;

  const defaultBindChannel = useMemo(() => {
    if (bindChannelsLoading || bindChannelStatuses.length === 0) return '';
    return bindChannelStatuses[0]?.name ?? '';
  }, [bindChannelStatuses, bindChannelsLoading]);

  const [newBindChannel, setNewBindChannel] = useState('');
  const trackedDefaultChannelRef = useRef(defaultBindChannel);
  if (
    panel === 'channels' &&
    !bindChannelsLoading &&
    defaultBindChannel &&
    trackedDefaultChannelRef.current !== defaultBindChannel &&
    (!newBindChannel || !bindChannelStatuses.some((c) => c.name === newBindChannel))
  ) {
    trackedDefaultChannelRef.current = defaultBindChannel;
    setNewBindChannel(defaultBindChannel);
  }
  trackedDefaultChannelRef.current = defaultBindChannel;

  const trimmedBindChannel = newBindChannel.trim();
  const sessionsEnabled = channelsEnabled && trimmedBindChannel.length > 0;
  const sessionsResource = useAsyncResource(
    () => getSessionChatIds(trimmedBindChannel),
    [panel, hasToken, trimmedBindChannel],
    { enabled: sessionsEnabled, initial: [] as SessionChatId[], errorData: [] },
  );
  const bindSessionChats = sessionsResource.data;
  const bindSessionsLoading = sessionsResource.loading;
  const setBindSessionChats = sessionsResource.setData;

  const [newBindSessionIdx, setNewBindSessionIdx] = useState<number | null>(null);
  const [newBindCustomPeer, setNewBindCustomPeer] = useState('');

  const trackedBindChannelRef = useRef(trimmedBindChannel);
  if (trackedBindChannelRef.current !== trimmedBindChannel) {
    trackedBindChannelRef.current = trimmedBindChannel;
    setNewBindSessionIdx(null);
  }

  const agentBindings = useMemo(() => {
    if (!selected) {
      return [];
    }
    return allBindings.filter((b) => b.agentId.toLowerCase() === selected.id.toLowerCase());
  }, [allBindings, selected?.id]);

  const refreshBindSessions = useCallback(() => {
    const ch = newBindChannel.trim();
    if (!ch) {
      return;
    }
    void getSessionChatIds(ch)
      .then((ids) => {
        setBindSessionChats(ids);
        setNewBindSessionIdx((i) => (i != null && i < ids.length ? i : null));
      })
      .catch(() => {
        setBindSessionChats([]);
        setNewBindSessionIdx(null);
      });
  }, [newBindChannel, setBindSessionChats]);

  const useManualChannel = !bindChannelsLoading && bindChannelStatuses.length === 0;
  const bindingsLoading = panel === 'channels' && hasToken && gatewayCfgLoading;

  const onRemoveBinding = useCallback(
    async (rule: GatewayConfigBinding) => {
      setBusy(true);
      setError(null);
      try {
        const nextList = allBindings.filter((b) => b !== rule);
        await patchGatewayBindings(nextList);
        bindingsDirtyRef.current = true;
        setLocalBindings(nextList);
      } catch (err) {
        setError(err instanceof Error ? err.message : saveErrorMessage);
      } finally {
        setBusy(false);
      }
    },
    [allBindings, saveErrorMessage, setBusy, setError],
  );

  const onAddBinding = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!selected || !newBindChannel.trim()) {
        return;
      }
      const match = buildNewBindingMatch(
        newBindChannel,
        newBindCustomPeer,
        newBindSessionIdx,
        bindSessionChats,
      );
      const nextList = [
        ...allBindings,
        {
          agentId: selected.id,
          priority: 100,
          enabled: true,
          match,
        },
      ];
      setBusy(true);
      setError(null);
      try {
        await patchGatewayBindings(nextList);
        bindingsDirtyRef.current = true;
        setLocalBindings(nextList);
        setNewBindSessionIdx(null);
        setNewBindCustomPeer('');
      } catch (err) {
        setError(err instanceof Error ? err.message : saveErrorMessage);
      } finally {
        setBusy(false);
      }
    },
    [
      allBindings,
      bindSessionChats,
      newBindChannel,
      newBindCustomPeer,
      newBindSessionIdx,
      saveErrorMessage,
      selected,
      setBusy,
      setError,
    ],
  );

  return {
    agentBindings,
    allBindings,
    bindChannelStatuses,
    bindChannelsLoading,
    bindSessionChats,
    bindSessionsLoading,
    bindingsLoading,
    newBindChannel,
    setNewBindChannel,
    newBindSessionIdx,
    setNewBindSessionIdx,
    newBindCustomPeer,
    setNewBindCustomPeer,
    onAddBinding,
    onRemoveBinding,
    refreshBindSessions,
    useManualChannel,
  };
}
