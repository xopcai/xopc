import { runPhoneCommandBuffer } from '../process/phone-process.js';
import { PhoneError } from './contracts.js';

export function runAdb(path: string, args: string[], signal?: AbortSignal, timeout = 15_000): Promise<Buffer> {
  signal?.throwIfAborted();
  return runPhoneCommandBuffer(path, args, signal, timeout).catch(() => {
    throw new PhoneError(signal?.aborted ? 'PHONE_CANCELLED' : 'PHONE_ADB_FAILED',
      signal?.aborted ? 'Phone operation stopped' : `ADB command failed (${args.includes('screencap') ? 'screenshot' : args.includes('devices') ? 'discovery' : 'device operation'}). Check ADB, device authorization and connection.`);
  });
}
