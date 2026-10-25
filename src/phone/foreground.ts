import { PhoneError } from './contracts.js';

export async function readPhoneForeground(command: (path: string, args: string[], signal?: AbortSignal) => Promise<Buffer>, path: string, serial: string, signal: AbortSignal): Promise<string> {
  // Filter on Android so foreground sampling does not compete with video bandwidth.
  const activity = (await command(path, ['-s', serial, 'shell', 'sh', '-c', 'dumpsys activity activities | grep -m 1 -E "mResumedActivity|topResumedActivity"'], signal)).toString();
  const app = /(?:mResumedActivity|topResumedActivity)[^\n]*?\s([\w.]+)\//.exec(activity)?.[1];
  if (!app) throw new PhoneError('PHONE_APP_UNKNOWN', 'Unable to identify the foreground app');
  return app;
}
