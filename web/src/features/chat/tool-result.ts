export type ToolResultMessage = {
  content: Array<{ type: 'text'; text?: string }>;
  isError: boolean;
};

/** Normalizes tool output text for the transcript. */
export function stringToToolResultMessage(text: string | undefined, isError: boolean): ToolResultMessage {
  return { content: [{ type: 'text', text: text ?? '' }], isError };
}
