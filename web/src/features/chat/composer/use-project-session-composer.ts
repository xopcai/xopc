import { useCallback, useEffect, useRef, useState } from 'react';
import {
  executionModePreferenceForProject,
  type ProjectEnvironmentOptions,
  type SessionCreateRequest,
} from '@xopcai/gateway-contract';
import useSWR from 'swr';

import {
  readNewSessionPreferences,
  rememberProjectExecutionMode,
} from '@/features/chat/session/new-session-preferences';
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
  completion: Promise<string | null>;
  resolve: (sessionKey: string | null) => void;
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
  const projectSendPendingRef = useRef(false);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const { data: options, error, isValidating, mutate } = useSWR(
    preparation ? ['project-environment-options', baseUrl, token, preparation.project.id] : null,
    async () => (await fetchJson<{ options: ProjectEnvironmentOptions }>(apiUrl(`/api/projects/${encodeURIComponent(preparation!.project.id)}/environment-options`))).options,
    { keepPreviousData: false, revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const supportsWorktree = Boolean(options?.localAvailable && options.worktreeUnavailableReason !== 'git_commit_required' && options.worktreeUnavailableReason !== 'workspace_unavailable');
  const mode: ExecutionMode = supportsWorktree
    ? selection?.preparation === preparation
      ? selection.mode
      : preparation
        ? executionModePreferenceForProject(readNewSessionPreferences(), preparation.project.id) ?? 'local_checkout'
        : 'local_checkout'
    : 'local_checkout';
  const allowed = Boolean(!error && options?.localAvailable && (mode === 'local_checkout' || !options.worktreeUnavailableReason));
  const finish = useCallback((accepted: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(accepted ? current.sessionKey : null);
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
    pendingRef.current?.resolve(null);
    pendingRef.current = null;
  }, []);

  const prepareSession = useCallback(async (): Promise<string | null> => {
    if (!preparation) return sessionKey;
    const currentPending = pendingRef.current;
    if (currentPending) {
      return currentPending.preparation === preparation ? currentPending.completion : null;
    }
    if (!allowed || isValidating) return null;
    setFailure(null);
    let resolveCompletion!: (sessionKey: string | null) => void;
    const completion = new Promise<string | null>((resolve) => {
      resolveCompletion = resolve;
    });
    const current: PendingCreation = {
      preparation,
      baseUrl,
      token,
      sessionKey: null,
      completion,
      resolve: resolveCompletion,
    };
    pendingRef.current = current;
    setPending(current);
    void Promise.resolve().then(() => preparation.create(mode)).then((key) => {
      if (pendingRef.current !== current) return;
      rememberProjectExecutionMode(preparation.project.id, mode);
      const created = { ...current, sessionKey: key };
      pendingRef.current = created;
      setPending(created);
    }).catch((cause) => {
      if (pendingRef.current !== current) return;
      setFailure({ preparation, message: cause instanceof Error ? cause.message : String(cause) });
      void mutate();
      finish(false);
    });
    return completion;
  }, [allowed, baseUrl, finish, isValidating, mode, mutate, preparation, sessionKey, token]);

  const send: ComposerSendHandler = async (...args) => {
    if (preparation) {
      if (projectSendPendingRef.current) return false;
      projectSendPendingRef.current = true;
      try {
        const preparedSessionKey = await prepareSession();
        if (!preparedSessionKey) return false;
        // Use the newly hydrated session's effort instead of the unbound composer's placeholder.
        args[2] = undefined;
      } finally {
        projectSendPendingRef.current = false;
      }
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
    prepareSession,
    send,
  };
}

export type ProjectSessionComposer = ReturnType<typeof useProjectSessionComposer>;
