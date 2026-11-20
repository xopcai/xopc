import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectEnvironmentOptions } from '@xopcai/gateway-contract';
import useSWR from 'swr';

import type { ProjectSessionPreparation } from '@/features/chat/session/use-chat-session-init';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import type { ComposerSendHandler } from './composer.types';

type PendingCreation = {
  preparation: ProjectSessionPreparation;
  baseUrl: string;
  token: string | undefined;
  conversationId: string | null;
  openedConversationId?: string;
  completion: Promise<string | null>;
  resolve: (conversationId: string | null) => void;
};

/** Keeps the first draft in the composer until its project session is ready. */
export function useProjectSessionComposer({ preparation, conversationId, ready, onSend }: {
  preparation: ProjectSessionPreparation | null;
  conversationId: string | null;
  ready: boolean;
  onSend: ComposerSendHandler;
}) {
  const token = useGatewayStore((state) => state.conversationId);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const [failure, setFailure] = useState<{ preparation: ProjectSessionPreparation; message: string } | null>(null);
  const [pending, setPending] = useState<PendingCreation | null>(null);
  const pendingRef = useRef<PendingCreation | null>(null);
  const projectSendPendingRef = useRef(false);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const boundConversationRef = useRef(conversationId);
  boundConversationRef.current = conversationId;
  const { data: options, error, isValidating, mutate } = useSWR(
    preparation ? ['project-environment-options', baseUrl, token, preparation.project.id] : null,
    async () => (await fetchJson<{ options: ProjectEnvironmentOptions }>(apiUrl(`/api/projects/${encodeURIComponent(preparation!.project.id)}/environment-options?mode=local_checkout`))).options,
    { keepPreviousData: false, revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const allowed = Boolean(!error && options?.localAvailable);
  const finish = useCallback((accepted: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(accepted ? current.conversationId : null);
  }, []);
  const getDraftHandoffTarget = useCallback(() => {
    const current = pendingRef.current;
    const gateway = useGatewayStore.getState();
    return current?.token === gateway.conversationId && current?.baseUrl === gateway.baseUrl
      ? current?.openedConversationId
      : undefined;
  }, []);

  useEffect(() => {
    if (!pending) return;
    if (pending.baseUrl !== baseUrl || pending.token !== token) {
      finish(false);
      return;
    }
    if (!pending.conversationId) {
      if (preparation !== pending.preparation && pending.openedConversationId !== conversationId) finish(false);
      return;
    }
    if (conversationId === pending.conversationId) {
      if (ready) finish(true);
    } else if (preparation !== pending.preparation) {
      finish(false);
    }
  }, [pending, conversationId, ready, preparation, finish, baseUrl, token]);

  useEffect(() => () => {
    pendingRef.current?.resolve(null);
    pendingRef.current = null;
  }, []);

  const prepareSession = useCallback(async (): Promise<string | null> => {
    if (!preparation) return conversationId;
    const currentPending = pendingRef.current;
    if (currentPending) {
      return currentPending.preparation === preparation ? currentPending.completion : null;
    }
    if (!allowed || isValidating) return null;
    setFailure(null);
    let resolveCompletion!: (conversationId: string | null) => void;
    const completion = new Promise<string | null>((resolve) => {
      resolveCompletion = resolve;
    });
    const current: PendingCreation = {
      preparation,
      baseUrl,
      token,
      conversationId: null,
      completion,
      resolve: resolveCompletion,
    };
    pendingRef.current = current;
    setPending(current);
    void Promise.resolve().then(() => preparation.create('local_checkout', undefined, (key) => {
      // The route can commit before the creation promise resumes.
      if (pendingRef.current === current) current.openedConversationId = key;
    })).then((key) => {
      if (pendingRef.current !== current) return;
      const created = { ...current, conversationId: key };
      pendingRef.current = created;
      setPending(created);
    }).catch((cause) => {
      if (pendingRef.current !== current) return;
      setFailure({ preparation, message: cause instanceof Error ? cause.message : String(cause) });
      void mutate();
      finish(false);
    });
    return completion;
  }, [allowed, baseUrl, finish, isValidating, mutate, preparation, conversationId, token]);

  const send: ComposerSendHandler = async (...args) => {
    let targetConversationId = conversationId;
    if (preparation) {
      if (projectSendPendingRef.current) return false;
      projectSendPendingRef.current = true;
      try {
        const preparedConversationId = await prepareSession();
        if (!preparedConversationId) return false;
        targetConversationId = preparedConversationId;
        // Use the newly hydrated session's effort instead of the unbound composer's placeholder.
        args[2] = undefined;
      } finally {
        projectSendPendingRef.current = false;
      }
    }
    // The session-bound callback changes after navigation; never send through the old one.
    if (!targetConversationId || boundConversationRef.current !== targetConversationId) return false;
    const accepted = await onSendRef.current(...args);
    return accepted === false ? false : { conversationId: targetConversationId };
  };

  return {
    options, checking: isValidating, checkFailed: Boolean(error), allowed,
    busy: Boolean(pending && (pending.preparation === preparation || (pending.conversationId && pending.conversationId === conversationId))),
    failure: failure?.preparation === preparation ? failure.message : null,
    retry: () => void mutate(),
    getDraftHandoffTarget,
    prepareSession,
    send,
  };
}

export type ProjectSessionComposer = ReturnType<typeof useProjectSessionComposer>;
