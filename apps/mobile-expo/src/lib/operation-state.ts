export type OperationState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; message: string };

export type OperationEvent =
  | { type: 'start' }
  | { type: 'succeed' }
  | { type: 'fail'; message: string }
  | { type: 'dismiss' };

export const idleOperationState: OperationState = { status: 'idle' };

export function reduceOperationState(_state: OperationState, event: OperationEvent): OperationState {
  switch (event.type) {
    case 'start':
      return { status: 'pending' };
    case 'fail':
      return { status: 'error', message: event.message };
    case 'succeed':
    case 'dismiss':
      return idleOperationState;
  }
}
