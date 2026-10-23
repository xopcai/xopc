import { describe, expect, it, vi } from 'vitest';
import { GatewayService } from '../service.js';

describe('embedded Gateway task dispatch lifecycle', () => {
  function host(enabled?: boolean) {
    return { stopping: false, serviceConfig: { taskDispatchEnabled: enabled },
      taskAllocationDispatcher: { dispatch: vi.fn() }, taskResultDispatch: vi.fn(),
      taskRunDispatch: vi.fn(), taskMainUpdateDispatch: vi.fn() };
  }
  it('does not lazily start task allocation or execution in a foreground-only host', () => {
    const service = host(false);
    GatewayService.prototype.dispatchTaskRuns.call(service as never);
    expect(service.taskAllocationDispatcher.dispatch).not.toHaveBeenCalled();
    expect(service.taskRunDispatch).not.toHaveBeenCalled();
    expect(service.taskResultDispatch).not.toHaveBeenCalled();
    expect(service.taskMainUpdateDispatch).not.toHaveBeenCalled();
  });
  it('keeps ordinary Gateway dispatch enabled by default', () => {
    const service = host();
    GatewayService.prototype.dispatchTaskRuns.call(service as never);
    expect(service.taskAllocationDispatcher.dispatch).toHaveBeenCalledOnce();
    expect(service.taskRunDispatch).toHaveBeenCalledOnce();
    expect(service.taskResultDispatch).toHaveBeenCalledOnce();
    expect(service.taskMainUpdateDispatch).toHaveBeenCalledOnce();
  });
});
