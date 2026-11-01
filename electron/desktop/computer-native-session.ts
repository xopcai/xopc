import { ComputerBroker, type ComputerBrokerHost } from '../../src/computer/broker.js';
import type { CuaComputerDriver } from '../computer/cua-driver.js';
import { DesktopComputerResources } from './computer-resources.js';
import { DesktopComputerSession } from './computer-session.js';

/** A remote grant owns its own driver, Broker and approval hook; no local app access policy is inherited. */
export function createNativeComputerSession(options: {
  driver: Pick<CuaComputerDriver, 'warmup' | 'ownedProcessIdentity' | 'discover' | 'resolveTarget' | 'observe' | 'perform' | 'stop' | 'validateAction'>;
  resources: DesktopComputerResources;
  current(): boolean;
  requestApproval: ComputerBrokerHost['requestApproval'];
  uploadFrame: ConstructorParameters<typeof DesktopComputerSession>[0]['uploadFrame'];
}): DesktopComputerSession {
  return new DesktopComputerSession({ current: options.current, uploadFrame: options.uploadFrame,
    createBroker: () => new ComputerBroker(options.driver, { deferApproval: false, isVisible: options.current,
      requestApproval: async (request, signal) => {
        signal.throwIfAborted();
        if (!options.current()) return false;
        const allowed = await options.requestApproval(structuredClone(request), signal);
        signal.throwIfAborted();
        return allowed && options.current();
      },
    }, { enabled: true, maxSessionDurationMs: 120000, idleGrantTtlMs: 120000 }),
    prepareOperation: async (intent, signal) => {
      signal.throwIfAborted();
      if (!options.current()) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
      await options.resources.begin(intent);
      signal.throwIfAborted();
      if (!options.current()) throw new Error('DESKTOP_COMPUTER_AUTHORITY_INVALID');
      // Warmup checks the private transport and existing OS permissions; it performs no application input or capture.
      await options.driver.warmup();
      signal.throwIfAborted();
      const identity = options.driver.ownedProcessIdentity();
      if (!identity || !options.current()) throw new Error('DESKTOP_COMPUTER_DRIVER_IDENTITY_UNAVAILABLE');
      await options.resources.ready(intent, identity);
      signal.throwIfAborted();
    },
  });
}
