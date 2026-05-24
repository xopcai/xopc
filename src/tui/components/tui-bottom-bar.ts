import type { Component } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

import { theme } from '../theme.js';
import { formatContextUsageLabel } from '../tui-context-usage.js';
import { getGitBranchCached } from '../tui-git-branch.js';
import type { TuiState } from '../tui-types.js';

const BUSY_ACTIVITY = new Set(['sending', 'waiting', 'streaming', 'running']);

/** Compact token counts (aligned with pi coding-agent footer). */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function shortenPath(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

/**
 * Multi-line footer below the input editor (pi coding-agent style):
 * cwd · session, then a single padded row: status/tokens on the left, model on the right.
 */
export class TuiBottomBar implements Component {
  private extensionLines: string[] = [];
  private extensionStatusParts: string[] = [];

  constructor(
    private readonly getState: () => TuiState,
    private readonly getThinkingDefault: () => string | undefined,
  ) {}

  setExtensionLines(lines: string[]): void {
    this.extensionLines = lines;
  }

  setExtensionStatusParts(parts: string[]): void {
    this.extensionStatusParts = parts;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.getState();
    const cwdRaw = process.cwd();
    const cwd = shortenPath(cwdRaw);
    const branch = getGitBranchCached(cwdRaw);
    const cwdWithBranch = branch ? `${cwd} (${branch})` : cwd;
    const sessionLine = state.sessionInfo.displayName ?? `session ${state.currentSessionKey}`;
    const pwdLine = truncateToWidth(
      theme.dim(`${cwdWithBranch} · ${sessionLine}`),
      width,
      theme.dim('…'),
    );

    const busy = BUSY_ACTIVITY.has(state.activityStatus);
    const leftParts: string[] = [state.connectionStatus];
    if (!busy && state.activityStatus && state.activityStatus !== 'idle') {
      leftParts.push(state.activityStatus);
    }
    if (state.sessionInfo.totalTokens != null) {
      leftParts.push(formatTokens(state.sessionInfo.totalTokens));
    }
    const ctxLabel = formatContextUsageLabel(state.sessionInfo.contextUsagePercent ?? null);
    if (ctxLabel) {
      leftParts.push(ctxLabel);
    }
    if (state.isCompacting) {
      leftParts.push('compact…');
    } else if (state.compactionQueue.length > 0) {
      leftParts.push(`C${state.compactionQueue.length}`);
    }
    if (state.messageFollowUpQueue.length > 0) {
      leftParts.push(`Q${state.messageFollowUpQueue.length}`);
    }
    for (const part of this.extensionStatusParts) {
      leftParts.push(part);
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
    for (const extLine of this.extensionLines) {
      lines.push(truncateToWidth(theme.dim(extLine), width, theme.dim('…')));
    }
    return lines;
  }
}
