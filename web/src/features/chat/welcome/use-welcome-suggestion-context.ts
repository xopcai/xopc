import { useCallback, useEffect, useState } from 'react';

import type { SessionManager } from '@/features/chat/session/session-manager';
import type { WelcomeSuggestionContext, WelcomeSuggestionContextStatus } from '@/features/chat/welcome/welcome-suggestions';
import { fetchProject, inferProjectDefaults, type Project, type ProjectKind } from '@/features/projects/api';
import { getSessionDetail } from '@/features/sessions/session-api';

type ProjectWithKind = Project & {
  kind?: ProjectKind;
  projectKind?: ProjectKind;
};

type UseWelcomeSuggestionContextOptions = {
  enabled: boolean;
  sessionKey?: string | null;
  sourceNoteId?: string | null;
  sourceNoteTitle?: string | null;
  sourceContextPending?: boolean;
  sourceContextFailed?: boolean;
  effectiveWorkspacePath?: string | null;
  workingDirectoryLocked?: boolean;
  sessionManager: SessionManager;
};

export type WelcomeSuggestionContextState = {
  context: WelcomeSuggestionContext;
  status: WelcomeSuggestionContextStatus;
  retry: () => void;
};

type InternalWelcomeSuggestionContextState = Omit<WelcomeSuggestionContextState, 'retry'> & {
  key: string;
};

function projectKindFromWire(project: ProjectWithKind, inferredKind: ProjectKind | null): ProjectKind {
  return project.kind ?? project.projectKind ?? inferredKind ?? 'general';
}

function projectWorkspace(project: Project): string | undefined {
  return project.effectiveWorkspaceRoot || project.workspaceRoot || undefined;
}

async function inferWorkspaceSuggestionContext(path: string): Promise<WelcomeSuggestionContext> {
  const result = await inferProjectDefaults({ workspaceRoot: path });
  return result.inference.kind === 'coding'
    ? { kind: 'codingWorkspace', path }
    : { kind: 'workingDirectory', path };
}

function contextStateKey({
  attempt,
  enabled,
  sessionKey,
  sourceNoteId,
  sourceNoteTitle,
  sourceContextPending,
  sourceContextFailed,
  effectiveWorkspacePath,
  workingDirectoryLocked,
}: UseWelcomeSuggestionContextOptions & { attempt: number }): string {
  if (!enabled) return 'disabled';
  if (sourceContextPending) return `pending:${sessionKey ?? ''}`;
  if (sourceNoteId) return `note:${sourceNoteId}:${sourceNoteTitle?.trim() ?? ''}`;
  if (workingDirectoryLocked && effectiveWorkspacePath?.trim()) {
    return `workspace:${sessionKey ?? ''}:${effectiveWorkspacePath.trim()}`;
  }
  if (sessionKey) return `session:${sessionKey}:attempt:${attempt}:failed:${sourceContextFailed ? '1' : '0'}`;
  return 'empty';
}

function immediateContextState(
  options: UseWelcomeSuggestionContextOptions & { attempt: number },
): InternalWelcomeSuggestionContextState {
  const key = contextStateKey(options);
  if (!options.enabled) {
    return { key, context: { kind: 'empty' }, status: 'ready' };
  }
  if (options.sourceContextPending) {
    return { key, context: { kind: 'empty' }, status: 'loading' };
  }
  if (options.sourceNoteId) {
    return {
      key,
      context: {
        kind: 'note',
        noteId: options.sourceNoteId,
        title: options.sourceNoteTitle?.trim() || 'Untitled note',
      },
      status: 'ready',
    };
  }
  const effectiveWorkspacePath = options.effectiveWorkspacePath?.trim();
  if (options.workingDirectoryLocked && effectiveWorkspacePath) {
    return {
      key,
      context: { kind: 'workingDirectory', path: effectiveWorkspacePath },
      status: options.sourceContextFailed ? 'degraded' : 'ready',
    };
  }
  if (options.sessionKey) {
    return { key, context: { kind: 'empty' }, status: 'loading' };
  }
  return { key, context: { kind: 'empty' }, status: 'ready' };
}

export function useWelcomeSuggestionContext({
  enabled,
  sessionKey,
  sourceNoteId,
  sourceNoteTitle,
  sourceContextPending = false,
  sourceContextFailed = false,
  effectiveWorkspacePath,
  workingDirectoryLocked = false,
  sessionManager,
}: UseWelcomeSuggestionContextOptions): WelcomeSuggestionContextState {
  const [attempt, setAttempt] = useState(0);
  const currentOptions = {
    attempt,
    enabled,
    sessionKey,
    sourceNoteId,
    sourceNoteTitle,
    sourceContextPending,
    sourceContextFailed,
    effectiveWorkspacePath,
    workingDirectoryLocked,
    sessionManager,
  };
  const currentKey = contextStateKey(currentOptions);
  const [state, setState] = useState<InternalWelcomeSuggestionContextState>(() =>
    immediateContextState(currentOptions),
  );
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setState({ key: currentKey, context: { kind: 'empty' }, status: 'ready' });
      return undefined;
    }

    if (sourceContextPending) {
      setState({ key: currentKey, context: { kind: 'empty' }, status: 'loading' });
      return undefined;
    }

    if (sourceNoteId) {
      setState({
        key: currentKey,
        context: {
          kind: 'note',
          noteId: sourceNoteId,
          title: sourceNoteTitle?.trim() || 'Untitled note',
        },
        status: 'ready',
      });
      return undefined;
    }

    const syncWorkspacePath = workingDirectoryLocked ? effectiveWorkspacePath?.trim() : undefined;
    if (syncWorkspacePath) {
      setState({
        key: currentKey,
        context: { kind: 'workingDirectory', path: syncWorkspacePath },
        status: sourceContextFailed ? 'degraded' : 'ready',
      });
      void (async () => {
        try {
          const context = await inferWorkspaceSuggestionContext(syncWorkspacePath);
          if (!cancelled) {
            setState({ key: currentKey, context, status: sourceContextFailed ? 'degraded' : 'ready' });
          }
        } catch {
          if (!cancelled) {
            setState({
              key: currentKey,
              context: { kind: 'workingDirectory', path: syncWorkspacePath },
              status: 'degraded',
            });
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!sessionKey) {
      setState({ key: currentKey, context: { kind: 'empty' }, status: 'ready' });
      return undefined;
    }

    setState({ key: currentKey, context: { kind: 'empty' }, status: 'loading' });

    void (async () => {
      let degraded = sourceContextFailed;
      let projectId: string | null = null;
      try {
        const detail = await getSessionDetail(sessionKey);
        projectId = (detail as { projectId?: string | null }).projectId?.trim() || null;
      } catch {
        degraded = true;
      }

      if (projectId) {
        try {
          const project = (await fetchProject(projectId)) as ProjectWithKind;
          let inferredKind: ProjectKind | null = project.kind ?? project.projectKind ?? null;
          if (!inferredKind) {
            try {
              const result = await inferProjectDefaults({
                name: project.name,
                description: project.description,
                workspaceRoot: project.effectiveWorkspaceRoot ?? project.workspaceRoot,
              });
              inferredKind = result.inference.kind;
            } catch {
              degraded = true;
              inferredKind = 'general';
            }
          }
          if (cancelled) return;
          const kind = projectKindFromWire(project, inferredKind);
          setState({
            key: currentKey,
            context:
              kind === 'coding'
                ? {
                    kind: 'codingProject',
                    projectId,
                    projectName: project.name,
                    workspaceRoot: projectWorkspace(project),
                  }
                : { kind: 'generalProject', projectId, projectName: project.name },
            status: degraded ? 'degraded' : 'ready',
          });
          return;
        } catch {
          degraded = true;
        }
      }

      try {
        const config = await sessionManager.loadSessionAgentConfig(sessionKey);
        const path = config.workingDirectoryLocked ? config.effectiveWorkspacePath.trim() : '';
        if (cancelled) return;
        if (path) {
          let context: WelcomeSuggestionContext = { kind: 'workingDirectory', path };
          try {
            context = await inferWorkspaceSuggestionContext(path);
          } catch {
            degraded = true;
          }
          if (cancelled) return;
          setState({
            key: currentKey,
            context,
            status: degraded ? 'degraded' : 'ready',
          });
          return;
        }
      } catch {
        degraded = true;
      }

      if (!cancelled) {
        setState({ key: currentKey, context: { kind: 'empty' }, status: degraded ? 'degraded' : 'ready' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    attempt,
    currentKey,
    enabled,
    sessionKey,
    sessionManager,
    sourceContextFailed,
    sourceContextPending,
    effectiveWorkspacePath,
    workingDirectoryLocked,
    sourceNoteId,
    sourceNoteTitle,
  ]);

  const visibleState = state.key === currentKey ? state : immediateContextState(currentOptions);

  return { context: visibleState.context, status: visibleState.status, retry };
}
