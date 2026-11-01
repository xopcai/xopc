import { DesktopBrowserProcess } from './browser-process.js';
import { DesktopBrowserSession } from './browser-session.js';

/** Every worker starts only after the operation journal, followed by both fsynced process barriers before dispatch. */
export function createNativeBrowserSession(options: ConstructorParameters<typeof DesktopBrowserProcess>[0] & {
  uploadFrame: ConstructorParameters<typeof DesktopBrowserSession>[0]['uploadFrame'];
}): DesktopBrowserSession {
  let process: DesktopBrowserProcess | undefined;
  return new DesktopBrowserSession({ current: options.current, uploadFrame: options.uploadFrame,
    createBroker: () => { process = new DesktopBrowserProcess(options); return process; },
    prepareOperation: async (intent, signal) => {
      if (!process) throw new Error('DESKTOP_BROWSER_WORKER_UNAVAILABLE');
      await process.prepare(intent, signal);
    },
  });
}
