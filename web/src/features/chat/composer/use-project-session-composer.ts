import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectEnvironmentOptions, SessionCreateRequest } from '@xopcai/gateway-contract';
import useSWR from 'swr';

import type { ProjectSessionPreparation } from '@/features/chat/session/use-chat-session-init';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import type { ComposerSendHandler } from './composer.types';

type ExecutionMode = NonNullable<SessionCreateRequest['executionMode']>;
type PendingCreation = {
  preparation: ProjectSessionPreparation;
  baseUrl: string;
  token: string | undefined;
  sessionKey: string | null;
  resolve: (accepted: boolean) => void;
};

/** Keeps the first draft in the composer until its chosen environment is ready. */
export function useProjectSessionComposer({ preparation, sessionKey, ready, onSend }: {
  preparation: ProjectSessionPreparation | null;
  sessionKey: string | null;
  ready: boolean;
  onSend: ComposerSendHandler;
}) {
  const token = useGatewayStore((state) => state.token);
  const baseUrl = useGatewayStore((state) => state.baseUrl);
  const [selection, setSelection] = useState<{ preparation: ProjectSessionPreparation; mode: ExecutionMode } | null>(null);
  const [failure, setFailure] = useState<{ preparation: ProjectSessionPreparation; message: string } | null>(null);
  const [pending, setPending] = useState<PendingCreation | null>(null);
  const pendingRef = useRef<PendingCreation | null>(null);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const mode = selection?.preparation === preparation ? selection.mode : preparation?.project.executionMode ?? 'local_checkout';
  const { data: options, error, isValidating, mutate } = useSWR(
    preparation ? ['project-environment-options', baseUrl, token, preparation.project.id] : null,
    async () => (await fetchJson<{ options: ProjectEnvironmentOptions }>(apiUrl(`/api/projects/${encodeURIComponent(preparation!.project.id)}/environment-options`))).options,
    { keepPreviousData: false, revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const allowed = Boolean(!error && options?.localAvailable && (mode === 'local_checkout' || !options.worktreeUnavailableReason));
  const finish = useCallback((accepted: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(accepted);
  }, []);

  useEffect(() => {
    if (!pending) return;
    if (pending.baseUrl !== baseUrl || pending.token !== token) {
      finish(false);
      return;
    }
    if (!pending.sessionKey) return;
    if (sessionKey === pending.sessionKey) {
      if (ready) finish(true);
    } else if (preparation !== pending.preparation) {
      finish(false);
    }
  }, [pending, sessionKey, ready, preparation, finish, baseUrl, token]);

  useEffect(() => () => {
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
  }, []);

  const send: ComposerSendHandler = async (...args) => {
    if (pendingRef.current) return false;
    if (preparation) {
      if (!allowed || isValidating) return false;
      setFailure(null);
      const accepted = await new Promise<boolean>((resolve) => {
        const current: PendingCreation = { preparation, baseUrl, token, sessionKey: null, resolve };
        pendingRef.current = current;
        setPending(current);
        void Promise.resolve().then(() => preparation.create(mode)).then((key) => {
          if (pendingRef.current !== current) return;
          const created = { ...current, sessionKey: key };
          pendingRef.current = created;
          setPending(created);
        }).catch((cause) => {
          if (pendingRef.current !== current) return;
          setFailure({ preparation, message: cause instanceof Error ? cause.message : String(cause) });
          void mutate();
          finish(false);
        });
      });
      if (!accepted) return false;
      // Use the newly hydrated session's effort instead of the unbound composer's placeholder.
      args[2] = undefined;
    }
    // The session-bound callback changes after navigation; never send through the old one.
    void onSendRef.current(...args);
    return true;
  };

  return {
    mode, options, checking: isValidating, checkFailed: Boolean(error), allowed,
    busy: Boolean(pending && (pending.preparation === preparation || (pending.sessionKey && pending.sessionKey === sessionKey))),
    failure: failure?.preparation === preparation ? failure.message : null,
    changeMode: (next: ExecutionMode) => {
      if (!preparation || pendingRef.current) return;
      setSelection({ preparation, mode: next });
      setFailure(null);
    },
    retry: () => void mutate(),
    send,
  };
}

export type ProjectSessionComposer = ReturnType<typeof useProjectSessionComposer>;
