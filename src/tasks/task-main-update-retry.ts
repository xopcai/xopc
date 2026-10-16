export const TASK_MAIN_UPDATE_MAX_ATTEMPTS = 20;

export class TaskMainUpdateExhaustedError extends Error {
  constructor() {
    super('Task update retry limit reached');
    this.name = 'TaskMainUpdateExhaustedError';
  }
}

export function taskMainUpdateRetryDelay(error: unknown, failures: number): number {
  const message = error instanceof Error ? error.message : String(error);
  const rateLimited = /\b429\b|rate[_ -]?limit|platform_token_limit_exceeded/i.test(message);
  const baseMs = rateLimited ? 30_000 : 1_000;
  const capMs = rateLimited ? 15 * 60_000 : 60_000;
  return Math.min(capMs, baseMs * 2 ** Math.max(0, failures - 1));
}
