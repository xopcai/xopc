import { AsyncLocalStorage } from 'node:async_hooks';

const operations = new AsyncLocalStorage<string>();
export function currentOperationId(): string | undefined { return operations.getStore(); }
export function withOperation<T>(operationId: string, run: () => T): T { return operations.run(operationId, run); }
