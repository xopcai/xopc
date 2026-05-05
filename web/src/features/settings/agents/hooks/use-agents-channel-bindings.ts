import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';

import {
  getChannels,
  getSessionChatIds,
  type ChannelStatus,
  type SessionChatId,
} from '@/features/cron/cron-api';
import {
  patchGatewayBindings,
  type GatewayAgentRow,
  type GatewayConfigBinding,
} from '@/features/settings/agents-admin-api';

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

  const [allBindings, setAllBindings] = useState<GatewayConfigBinding[]>([]);
  const [newBindChannel, setNewBindChannel] = useState('');
  const [bindChannelStatuses, setBindChannelStatuses] = useState<ChannelStatus[]>([]);
  const [bindChannelsLoading, setBindChannelsLoading] = useState(false);
  const [bindSessionChats, setBindSessionChats] = useState<SessionChatId[]>([]);
  const [bindSessionsLoading, setBindSessionsLoading] = useState(false);
  const [newBindSessionIdx, setNewBindSessionIdx] = useState<number | null>(null);
  const [newBindCustomPeer, setNewBindCustomPeer] = useState('');

  const agentBindings = useMemo(() => {
    if (!selected) {
      return [];
    }
    return allBindings.filter((b) => b.agentId.toLowerCase() === selected.id.toLowerCase());
  }, [allBindings, selected?.id]);

  useEffect(() => {
    if (panel !== 'channels' || !hasToken) {
      return;
    }
    setAllBindings(bindingsFromConfig);
  }, [panel, hasToken, bindingsFromConfig]);

  useEffect(() => {
    if (panel !== 'channels' || !hasToken) {
      return;
    }
    let cancelled = false;
    setBindChannelsLoading(true);
    void getChannels()
      .then((list) => {
        if (!cancelled) {
          setBindChannelStatuses(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBindChannelStatuses([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBindChannelsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken]);

  useEffect(() => {
    if (bindChannelsLoading || panel !== 'channels' || bindChannelStatuses.length === 0) {
      return;
    }
    setNewBindChannel((prev) => {
      const valid = Boolean(prev) && bindChannelStatuses.some((c) => c.name === prev);
      if (valid) {
        return prev;
      }
      return bindChannelStatuses[0].name;
    });
  }, [bindChannelsLoading, panel, bindChannelStatuses]);

  useEffect(() => {
    if (panel !== 'channels' || !hasToken) {
      return;
    }
    const ch = newBindChannel.trim();
    if (!ch) {
      setBindSessionChats([]);
      return;
    }
    let cancelled = false;
    setNewBindSessionIdx(null);
    setBindSessionsLoading(true);
    void getSessionChatIds(ch)
      .then((ids) => {
        if (!cancelled) {
          setBindSessionChats(ids);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBindSessionChats([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBindSessionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panel, hasToken, newBindChannel]);

  const refreshBindSessions = useCallback(() => {
    const ch = newBindChannel.trim();
    if (!ch) {
      return;
    }
    setBindSessionsLoading(true);
    void getSessionChatIds(ch)
      .then((ids) => {
        setBindSessionChats(ids);
        setNewBindSessionIdx((i) => (i != null && i < ids.length ? i : null));
      })
      .catch(() => {
        setBindSessionChats([]);
        setNewBindSessionIdx(null);
      })
      .finally(() => {
        setBindSessionsLoading(false);
      });
  }, [newBindChannel]);

  const useManualChannel = !bindChannelsLoading && bindChannelStatuses.length === 0;
  const bindingsLoading = panel === 'channels' && hasToken && gatewayCfgLoading;

  const onRemoveBinding = useCallback(
    async (rule: GatewayConfigBinding) => {
      setBusy(true);
      setError(null);
      try {
        const nextList = allBindings.filter((b) => b !== rule);
        await patchGatewayBindings(nextList);
        setAllBindings(nextList);
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
        setAllBindings(nextList);
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
