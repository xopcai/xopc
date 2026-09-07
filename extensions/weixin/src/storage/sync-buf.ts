import { DurableState } from '@xopcai/xopc/storage/sqlite/durable-state.js';

const state = new DurableState<string>('weixin-cursors');
export function loadGetUpdatesBuf(accountId: string): string | undefined { return state.get(accountId); }
export function saveGetUpdatesBuf(accountId: string, cursor: string): void { state.set(accountId, cursor); }
export function deleteGetUpdatesBuf(accountId: string): void { state.delete(accountId); }
