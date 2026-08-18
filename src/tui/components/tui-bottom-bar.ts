import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { Component } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

import { theme } from '../theme.js';
import { formatContextUsageLabel } from '../tui-context-usage.js';
import { getGitBranchCached } from '../tui-git-branch.js';
import { formatActiveRunStatus } from '../tui-run-status-format.js';
import type { TuiState } from '../tui-types.js';

const BUSY_ACTIVITY = new Set([
  'sending',
  'waiting',
  'streaming',
  'running',
  'compacting',
  'stalled',
  'recovering',
  'aborting',
]);

/** Compact token counts (aligned with pi coding-agent footer). */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

export function formatQueuedMessageLines(
  state: TuiState,
  width: number,
): string[] {
  const lines: string[] = [];
  const add = (label: string, text: string) => {
    const sanitized = sanitizeStatusText(text);
    if (!sanitized) return;
    lines.push(
      truncateToWidth(theme.dim(`${label}: ${sanitized}`), width, theme.dim('…')),
    );
  };

  for (const message of state.compactionQueue) {
    add('Queued', message);
  }
  return lines;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) return cwd;

  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === '' ||
    (relativeToHome !== '..' &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));

  if (!isInsideHome) return cwd;
  return relativeToHome === '' ? '~' : `~${sep}${relativeToHome}`;
}

function shortenPath(cwd: string): string {
  const formatted = formatCwdForFooter(cwd, process.env.HOME || process.env.USERPROFILE);
  if (formatted !== cwd) return formatted;
  return cwd;
}

/**
 * Multi-line footer below the input editor (pi coding-agent style):
 * cwd · session, then a single padded row: status/tokens on the left, model on the right.
 */
export class TuiBottomBar implements Component {
  private extensionLines: string[] = [];
  private extensionComponents: Component[] = [];
  private extensionStatusParts: string[] = [];
  private customComponent: Component | undefined;

  constructor(
    private readonly getState: () => TuiState,
    private readonly getThinkingDefault: () => string | undefined,
  ) {}

  setExtensionLines(lines: string[]): void {
    this.extensionLines = lines;
  }

  setExtensionComponents(components: Component[]): void {
    this.extensionComponents = components;
  }

  setExtensionStatusParts(parts: string[]): void {
    this.extensionStatusParts = parts;
  }

  setCustomComponent(component: Component | undefined): void {
    this.customComponent = component;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.customComponent) {
      const rendered = this.customComponent.render(width);
      return rendered.map((line) => truncateToWidth(line, width, theme.dim('…')));
    }

    const state = this.getState();
    const cwdRaw = state.sessionInfo.effectiveWorkspacePath;
    const cwdWithBranch = cwdRaw
      ? (() => {
          const cwd = shortenPath(cwdRaw);
          const branch = getGitBranchCached(cwdRaw);
          return branch ? `${cwd} (${branch})` : cwd;
        })()
      : 'workspace loading';
    const sessionLine = state.sessionInfo.displayName ?? `session ${state.currentSessionKey}`;
    const pwdLine = truncateToWidth(
      theme.dim(`${cwdWithBranch} · ${sessionLine}`),
      width,
      theme.dim('…'),
    );

    const busy = BUSY_ACTIVITY.has(state.activityStatus);
    const leftParts: string[] = [state.connectionStatus];
    const activeRunStatus = formatActiveRunStatus(state);
    if (activeRunStatus) {
      leftParts.push(activeRunStatus);
    } else if (!busy && state.activityStatus && state.activityStatus !== 'idle') {
      leftParts.push(state.activityStatus);
    }
    if (state.sessionInfo.totalTokens != null) {
      leftParts.push(formatTokens(state.sessionInfo.totalTokens));
    }
    const ctxLabel = formatContextUsageLabel(
      state.sessionInfo.contextUsagePercent ?? null,
      state.sessionInfo.contextWindow ?? null,
    );
    if (ctxLabel) {
      leftParts.push(ctxLabel);
    }
    if (state.isCompacting) {
      leftParts.push('compact…');
    } else if (state.compactionQueue.length > 0) {
      leftParts.push(`C${state.compactionQueue.length}`);
    }
    if (state.pendingInputCount > 0) {
      leftParts.push(`Q${state.pendingInputCount}`);
    }
    let statsLeft = leftParts.join(' · ');

    const modelId = state.sessionInfo.model ?? 'unknown';
    const prov = state.sessionInfo.modelProvider;
    const thinkingHint = state.showThinking
      ? `thinking:${this.getThinkingDefault() ?? 'on'}`
      : 'thinking:off';
    let rightSide = prov ? `(${prov}) ${modelId}` : modelId;
    rightSide = `${rightSide} • ${thinkingHint}`;

    const minPadding = 2;
    let statsLeftWidth = visibleWidth(statsLeft);
    if (statsLeftWidth > width) {
      statsLeft = truncateToWidth(statsLeft, width, '…');
      statsLeftWidth = visibleWidth(statsLeft);
    }

    const rightWidth = visibleWidth(rightSide);
    const totalNeeded = statsLeftWidth + minPadding + rightWidth;

    let statsLine: string;
    if (totalNeeded <= width) {
      const padding = ' '.repeat(width - statsLeftWidth - rightWidth);
      statsLine = statsLeft + padding + rightSide;
    } else {
      const availableForRight = width - statsLeftWidth - minPadding;
      if (availableForRight > 0) {
        const truncatedRight = truncateToWidth(rightSide, availableForRight, '');
        const tw = visibleWidth(truncatedRight);
        const padding = ' '.repeat(Math.max(0, width - statsLeftWidth - tw));
        statsLine = statsLeft + padding + truncatedRight;
      } else {
        statsLine = statsLeft;
      }
    }

    const statsDimmed = theme.dim(statsLine);
    const lines = [pwdLine, statsDimmed];
    if (this.extensionStatusParts.length > 0) {
      const statusLine = this.extensionStatusParts
        .map((part) => sanitizeStatusText(part))
        .filter(Boolean)
        .join(' ');
      if (statusLine) {
        lines.push(truncateToWidth(theme.dim(statusLine), width, theme.dim('…')));
      }
    }
    lines.push(...formatQueuedMessageLines(state, width));
    for (const extLine of this.extensionLines) {
      lines.push(truncateToWidth(theme.dim(sanitizeStatusText(extLine)), width, theme.dim('…')));
    }
    for (const component of this.extensionComponents) {
      for (const line of component.render(width)) {
        lines.push(truncateToWidth(line, width, theme.dim('…')));
      }
    }
    return lines;
  }
}
