export type ToolResultMessage = {
  content: Array<{ type: 'text'; text?: string }>;
  isError: boolean;
};

/** Same contract as `ui/src/tools/result-adapter.ts`. */
export function stringToToolResultMessage(text: string | undefined, isError: boolean): ToolResultMessage {
  return { content: [{ type: 'text', text: text ?? '' }], isError };
}
