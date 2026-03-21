import type { TemplateResult } from 'lit';

/**
 * Tool output shape aligned with @mariozechner/pi-ai (see pi-mono web-ui tools).
 * When pi-ai types are unavailable at build time, this structural type stays compatible.
 */
export type ToolContentPart = { type: string; text?: string };

export type ToolResultMessage<TDetails = unknown> = {
  content: ToolContentPart[];
  isError?: boolean;
  details?: TDetails;
};

export interface ToolRenderResult {
  content: TemplateResult;
  /** true = no outer tool card wrapper */
  isCustom: boolean;
}

export interface ToolRenderer<TParams = unknown, TDetails = unknown> {
  render(
    params: TParams | undefined,
    result: ToolResultMessage<TDetails> | undefined,
    isStreaming?: boolean,
  ): ToolRenderResult;
}
