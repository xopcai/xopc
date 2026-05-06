import { confirm, input } from '@inquirer/prompts';

import { beginDingtalkRegistration, waitForDingtalkRegistrationSuccess } from './auth/device-auth.js';
import { printDingtalkSetupUrl } from './print-qr.js';

export async function promptDingtalkCredentials(params: {
  timeoutMs: number;
}): Promise<{ clientId: string; clientSecret: string }> {
  const useScan = await confirm({
    message: 'Register a DingTalk app by scanning a QR code (recommended)?',
    default: true,
  });

  let clientId = '';
  let clientSecret = '';

  if (useScan) {
    const ac = new AbortController();
    const onSigint = () => {
      ac.abort();
    };
    process.once('SIGINT', onSigint);
    try {
      const begin = await beginDingtalkRegistration();
      console.log('\nScan with DingTalk to create / link the app:\n');
      await printDingtalkSetupUrl(begin.verificationUriComplete);
      if (begin.userCode) {
        console.log(`\nUser code: ${begin.userCode}\n`);
      }
      console.log('Waiting for registration (Ctrl+C to cancel)…\n');
      const expireSec = Math.min(begin.expiresInSeconds, Math.max(60, Math.floor(params.timeoutMs / 1000)));
      const creds = await waitForDingtalkRegistrationSuccess({
        deviceCode: begin.deviceCode,
        intervalSeconds: begin.intervalSeconds,
        expiresInSeconds: expireSec,
        signal: ac.signal,
      });
      clientId = creds.clientId;
      clientSecret = creds.clientSecret;
      console.log('\nRegistration succeeded.\n');
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      if (em === 'DingTalk registration cancelled.') {
        console.log('\nCancelled.\n');
        throw e;
      }
      console.log(`\nQR registration failed: ${em}\n`);
      const fallback = await confirm({ message: 'Enter Client ID / Secret manually instead?', default: true });
      if (!fallback) {
        throw e;
      }
    } finally {
      process.off('SIGINT', onSigint);
    }
  }

  if (!clientId) {
    clientId = (
      await input({
        message: 'DingTalk Client ID (App Key):',
        validate: (v) => (String(v ?? '').trim() ? true : 'Required'),
      })
    ).trim();
    clientSecret = (
      await input({
        message: 'DingTalk Client Secret:',
        validate: (v) => (String(v ?? '').trim() ? true : 'Required'),
      })
    ).trim();
  }

  return { clientId, clientSecret };
}
