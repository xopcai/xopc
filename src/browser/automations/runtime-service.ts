import type { Config } from '../../config/schema.js';
import type { EndpointToolRuntime } from '../../endpoint-tools/index.js';
import { createBrowserDriver } from '../drivers/create-driver.js';
import { BrowserRuntime } from '../runtime/browser-runtime.js';
import { runBrowserAutomation } from './runner.js';
import { BrowserAutomationService } from './service.js';

export function createRuntimeBrowserAutomationService(deps: {
  getConfig: () => Config;
  endpointTools?: EndpointToolRuntime;
  emit?: (type: string, payload: unknown) => void;
}): BrowserAutomationService {
  const runtime = new BrowserRuntime({
    getConfig: () => deps.getConfig().browser,
    createDriver: () => createBrowserDriver(deps.getConfig().browser, deps.endpointTools),
    allowedUploadRoots: [process.cwd()],
    emit: deps.emit,
  });
  return new BrowserAutomationService(async ({ definition, inputs, signal, onStep }) => {
    const taskKey = `browser-automation:${crypto.randomUUID()}`;
    try {
      const result = await runBrowserAutomation({ definition, inputs, runtime, taskKey, signal, onStep: onStep as never });
      return result.ok
        ? { ok: true, result: result.receipt }
        : { ok: false, error: 'error' in result ? result.error.message : 'Browser automation failed.' };
    } finally {
      await runtime.closeTaskSession(taskKey);
    }
  }, deps.emit);
}
