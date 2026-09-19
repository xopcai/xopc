export type TuiChatInputDelivery = 'next' | 'steer';

export type TuiChatInputStatus =
  | 'queued'
  | 'running'
  | 'injecting'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'suspended';

export interface TuiChatInput {
  id: string;
  content: string;
  requestedDelivery: TuiChatInputDelivery;
  effectiveDelivery: TuiChatInputDelivery;
  status: TuiChatInputStatus;
  version: number;
  position?: number;
  error?: string;
}

export interface TuiChatInputState {
  conversationId: string;
  revision: number;
  activeRunId?: string;
  activeInputId?: string;
  inputs: TuiChatInput[];
}

export function createEmptyChatInputState(conversationId: string): TuiChatInputState {
  return { conversationId, revision: -1, inputs: [] };
}

export function isPendingChatInput(input: TuiChatInput): boolean {
  return input.status === 'queued' || input.status === 'injecting' || input.status === 'interrupted';
}

export function countPendingChatInputs(inputs: readonly TuiChatInput[]): number {
  return inputs.filter(isPendingChatInput).length;
}

export function acceptChatInputState(
  current: TuiChatInputState,
  incoming: TuiChatInputState,
): TuiChatInputState {
  if (current.conversationId !== incoming.conversationId) return incoming;
  return incoming.revision >= current.revision ? incoming : current;
}

export function findLastEditableChatInput(state: TuiChatInputState): TuiChatInput | undefined {
  return state.inputs
    .filter((input) => input.status === 'queued')
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
    .at(-1);
}

export function commitDeliveredChatInput(
  state: TuiChatInputState,
  content: string,
): TuiChatInputState {
  const normalized = content.trim();
  if (!normalized) return state;
  const matches = (input: TuiChatInput, status: TuiChatInputStatus) =>
    input.status === status && input.content.trim() === normalized;
  let index = state.inputs.findIndex((input) => matches(input, 'injecting'));
  if (index < 0) index = state.inputs.findIndex((input) => matches(input, 'queued'));
  if (index < 0) return state;
  return {
    ...state,
    revision: state.revision + 1,
    inputs: state.inputs.filter((_, inputIndex) => inputIndex !== index),
  };
}
