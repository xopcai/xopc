import type { KeybindingsManager, OverlayOptions, TUI } from '@earendil-works/pi-tui';

import type {
  TuiContextUsage,
  TuiCustomComponent,
  TuiCustomFactory,
  TuiCustomFullFactory,
  TuiCustomLegacyFactory,
  TuiCustomOptions,
  TuiModelInfo,
  TuiModelRegistry,
  TuiModelRegistryModel,
  TuiNotifyLevel,
  TuiReadonlySessionManager,
  TuiReasoningLevel,
  TuiThinkingLevel,
  TuiVerboseLevel,
} from '../../extensions/types/tui.js';
import { getAllModels, getApiKey as getProviderApiKey } from '../../providers/index.js';
import type { ChatLog } from '../components/chat-log.js';
import type { TuiState } from '../tui-types.js';
import { computeContextUsagePercent } from '../tui-context-usage.js';
import { theme } from '../theme.js';

const BUSY_ACTIVITY_STATUSES = new Set<Partial<TuiState>['activityStatus']>([
  'sending',
  'waiting',
  'streaming',
  'running',
  'compacting',
]);

const MAX_WIDGET_LINES = 10;
const WIDGET_TRUNCATED_LINE = '... (widget truncated)';
export const STALE_EXTENSION_CONTEXT_MESSAGE =
  'This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().';

export function boundedWidgetLines(lines: string[]): string[] {
  if (lines.length <= MAX_WIDGET_LINES) return lines;
  return [...lines.slice(0, MAX_WIDGET_LINES), WIDGET_TRUNCATED_LINE];
}

export function createEmptySessionManager(cwd: string, sessionKey: string): TuiReadonlySessionManager {
  return {
    getEntries: () => [],
    getBranch: () => [],
    getLeafEntry: () => undefined,
    getLeafId: () => null,
    getEntry: () => undefined,
    getLabel: () => undefined,
    getHeader: () => null,
    getTree: () => [],
    getSessionId: () => sessionKey,
    getSessionFile: () => undefined,
    getSessionDir: () => undefined,
    getSessionName: () => undefined,
    getCwd: () => cwd,
  };
}

export function createDefaultModelRegistry(): TuiModelRegistry {
  return {
    find(provider, modelId) {
      return getAllModels().find(
        (model) => model.provider === provider && model.id === modelId,
      ) as unknown as TuiModelRegistryModel | undefined;
    },
    async getApiKeyAndHeaders(model) {
      const provider = typeof model.provider === 'string' ? model.provider : undefined;
      if (!provider) return { ok: false, error: 'Model provider is missing.' };
      try {
        const apiKey = await getProviderApiKey(provider);
        return { ok: true, apiKey, headers: {} };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { ok: false, error: errorMessage };
      }
    },
  };
}

export function resolveCustomOverlayOptions(
  component: TuiCustomComponent,
  customOpts?: TuiCustomOptions,
): OverlayOptions | undefined {
  const configured =
    typeof customOpts?.overlayOptions === 'function'
      ? customOpts.overlayOptions()
      : customOpts?.overlayOptions;
  if (configured) return configured as OverlayOptions;

  const width = (component as { width?: unknown }).width;
  if (typeof width === 'number') return { width };
  if (typeof width === 'string' && /^\d+%$/.test(width)) {
    return { width: width as `${number}%` };
  }
  return undefined;
}

export function invokeCustomFactory<T>(
  factory: TuiCustomFactory<T>,
  tui: TUI,
  keybindings: KeybindingsManager | undefined,
  done: (result: T) => void,
): TuiCustomComponent | Promise<TuiCustomComponent> {
  if (factory.length <= 1) {
    return (factory as TuiCustomLegacyFactory<T>)(done);
  }
  return (factory as TuiCustomFullFactory<T>)(tui, theme, keybindings, done);
}

export function disposeComponent(component: { dispose?(): void } | undefined): void {
  try {
    component?.dispose?.();
  } catch {
    // Ignore extension component cleanup failures.
  }
}

export function notifyInChatLog(chatLog: ChatLog, tui: TUI, message: string, level?: TuiNotifyLevel) {
  const prefix =
    level === 'error'
      ? theme.error('✖ ')
      : level === 'warn' || level === 'warning'
        ? '⚠ '
        : '';
  chatLog.addSystem(`${prefix}${message}`);
  tui.requestRender();
}

export function isTuiIdle(state: Partial<TuiState>): boolean {
  return (
    state.activeRunId == null &&
    !state.isCompacting &&
    !BUSY_ACTIVITY_STATUSES.has(state.activityStatus)
  );
}

export function hasPendingTuiMessages(state: Partial<TuiState>): boolean {
  return (
    (state.pendingInputCount ?? 0) > 0 || (state.compactionQueue?.length ?? 0) > 0
  );
}

export function getTuiContextUsage(state: Partial<TuiState>): TuiContextUsage | undefined {
  const sessionInfo = state.sessionInfo;
  if (!sessionInfo) return undefined;
  const estimatedTokens = sessionInfo.totalTokens ?? sessionInfo.contextTokens ?? null;
  const contextWindow = sessionInfo.contextWindow ?? null;
  if (estimatedTokens == null && contextWindow == null) return undefined;
  const usagePercent =
    sessionInfo.contextUsagePercent ??
    computeContextUsagePercent(estimatedTokens, contextWindow);
  return {
    estimatedTokens,
    tokens: estimatedTokens,
    contextWindow,
    usagePercent,
    percent: usagePercent,
  };
}

export function getTuiModelInfo(state: Partial<TuiState>): TuiModelInfo | undefined {
  const sessionInfo = state.sessionInfo;
  if (!sessionInfo) return undefined;
  const provider = sessionInfo.modelProvider?.trim() || undefined;
  const id = sessionInfo.model?.trim();
  if (!id && !provider) return undefined;
  return {
    ...(provider ? { provider } : {}),
    id: id || provider!,
    ref: provider && id ? `${provider}/${id}` : (id ?? provider!),
    contextWindow: sessionInfo.contextWindow ?? null,
  };
}

export function getTuiThinkingLevel(state: Partial<TuiState>): TuiThinkingLevel | undefined {
  const level = state.sessionInfo?.thinkingLevel?.trim();
  switch (level) {
    case 'off':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'adaptive':
      return level;
    default:
      return undefined;
  }
}

export function getTuiReasoningLevel(state: Partial<TuiState>): TuiReasoningLevel | undefined {
  const level = state.sessionInfo?.reasoningLevel?.trim();
  switch (level) {
    case 'off':
    case 'on':
    case 'stream':
      return level;
    default:
      return undefined;
  }
}

export function getTuiVerboseLevel(state: Partial<TuiState>): TuiVerboseLevel | undefined {
  const level = state.sessionInfo?.verboseLevel?.trim();
  switch (level) {
    case 'off':
    case 'on':
    case 'full':
      return level;
    default:
      return undefined;
  }
}
