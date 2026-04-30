/**
 * Assembles incremental LLM streaming deltas into displayable text.
 *
 * Tracks per-run thinking + content text, composes them for display,
 * and handles finalization.
 */

interface RunStreamState {
  thinkingText: string;
  contentText: string;
  displayText: string;
}

function composeDisplay(thinking: string, content: string, showThinking: boolean): string {
  if (!showThinking || !thinking) return content;
  const thinkingBlock = `<thinking>\n${thinking}\n</thinking>\n\n`;
  return content ? `${thinkingBlock}${content}` : thinkingBlock;
}

export class StreamAssembler {
  private runs = new Map<string, RunStreamState>();

  private getOrCreate(runId: string): RunStreamState {
    let state = this.runs.get(runId);
    if (!state) {
      state = { thinkingText: '', contentText: '', displayText: '' };
      this.runs.set(runId, state);
    }
    return state;
  }

  /** Append a content token delta. Returns updated display text, or null if unchanged. */
  ingestToken(runId: string, delta: string, showThinking: boolean): string | null {
    const state = this.getOrCreate(runId);
    state.contentText += delta;
    const next = composeDisplay(state.thinkingText, state.contentText, showThinking);
    if (next === state.displayText) return null;
    state.displayText = next;
    return next;
  }

  /** Update thinking content. Returns updated display text, or null if unchanged. */
  ingestThinking(
    runId: string,
    content: string,
    isDelta: boolean,
    showThinking: boolean,
  ): string | null {
    const state = this.getOrCreate(runId);
    state.thinkingText = isDelta ? state.thinkingText + content : content;
    const next = composeDisplay(state.thinkingText, state.contentText, showThinking);
    if (next === state.displayText) return null;
    state.displayText = next;
    return next;
  }

  /** Finalize a run and return the final display text. */
  finalize(runId: string, showThinking: boolean): string {
    const state = this.runs.get(runId);
    if (!state) return '';
    const final = composeDisplay(state.thinkingText, state.contentText, showThinking);
    this.runs.delete(runId);
    return final;
  }

  /** Get current display text for a run. */
  getDisplayText(runId: string): string {
    return this.runs.get(runId)?.displayText ?? '';
  }

  /** Drop a run without finalizing. */
  drop(runId: string): void {
    this.runs.delete(runId);
  }

  /** Clear all run state. */
  clear(): void {
    this.runs.clear();
  }
}
