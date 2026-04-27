/**
 * Feishu/Lark App Registration — QR scan-to-create and OAuth device flow.
 *
 * Shared between `cli-login.ts` (channels login) and `onboard-cli.ts` (onboard wizard).
 */

export type FeishuDomain = 'feishu' | 'lark';

export type AppRegistrationResult = {
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
  openId?: string;
};

const FEISHU_ACCOUNTS_URL = 'https://accounts.feishu.cn';
const LARK_ACCOUNTS_URL = 'https://accounts.larksuite.com';
const REGISTRATION_PATH = '/oauth/v1/app/registration';
const REQUEST_TIMEOUT_MS = 10_000;

function accountsBaseUrl(domain: FeishuDomain): string {
  return domain === 'lark' ? LARK_ACCOUNTS_URL : FEISHU_ACCOUNTS_URL;
}

async function postRegistration<T>(baseUrl: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`${baseUrl}${REGISTRATION_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return (await response.json()) as T;
}

/**
 * Check if the Feishu/Lark app registration endpoint supports scan-to-create.
 */
export async function initAppRegistration(domain: FeishuDomain): Promise<boolean> {
  type InitResponse = { supported_auth_methods?: string[] };
  try {
    const result = await postRegistration<InitResponse>(accountsBaseUrl(domain), { action: 'init' });
    return Boolean(result.supported_auth_methods?.includes('client_secret'));
  } catch {
    return false;
  }
}

/**
 * Start the device-code flow and return a QR URL for the user to scan.
 */
export async function beginAppRegistration(domain: FeishuDomain): Promise<{
  deviceCode: string;
  qrUrl: string;
  intervalSec: number;
  expireInSec: number;
}> {
  type RawBeginResponse = {
    device_code: string;
    verification_uri_complete: string;
    interval?: number;
    expire_in?: number;
  };
  const result = await postRegistration<RawBeginResponse>(accountsBaseUrl(domain), {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id',
  });
  const qrUrl = new URL(result.verification_uri_complete);
  qrUrl.searchParams.set('from', 'xopc_onboard');
  qrUrl.searchParams.set('tp', 'ob_cli_app');
  return {
    deviceCode: result.device_code,
    qrUrl: qrUrl.toString(),
    intervalSec: result.interval || 5,
    expireInSec: result.expire_in || 600,
  };
}

/**
 * Poll the registration endpoint until the user scans and confirms.
 */
export async function pollAppRegistration(params: {
  deviceCode: string;
  intervalSec: number;
  expireInSec: number;
  initialDomain: FeishuDomain;
}): Promise<
  | { status: 'success'; result: AppRegistrationResult }
  | { status: 'access_denied' | 'expired' | 'timeout'; message?: string }
  | { status: 'error'; message: string }
> {
  type PollResponse = {
    client_id?: string;
    client_secret?: string;
    user_info?: { open_id?: string; tenant_brand?: 'feishu' | 'lark' };
    error?: string;
    error_description?: string;
  };

  let domain: FeishuDomain = params.initialDomain;
  let intervalSec = params.intervalSec;
  let domainSwitched = false;
  const deadline = Date.now() + params.expireInSec * 1000;

  while (Date.now() < deadline) {
    let pollResponse: PollResponse;
    try {
      pollResponse = await postRegistration<PollResponse>(accountsBaseUrl(domain), {
        action: 'poll',
        device_code: params.deviceCode,
        tp: 'ob_cli_app',
      });
    } catch {
      await sleep(intervalSec * 1000);
      continue;
    }

    if (pollResponse.user_info?.tenant_brand) {
      const isLark = pollResponse.user_info.tenant_brand === 'lark';
      if (!domainSwitched && isLark) {
        domain = 'lark';
        domainSwitched = true;
        continue;
      }
    }

    if (pollResponse.client_id && pollResponse.client_secret) {
      return {
        status: 'success',
        result: {
          appId: pollResponse.client_id,
          appSecret: pollResponse.client_secret,
          domain,
          openId: pollResponse.user_info?.open_id,
        },
      };
    }

    if (pollResponse.error) {
      if (pollResponse.error === 'authorization_pending') {
        // Keep waiting.
      } else if (pollResponse.error === 'slow_down') {
        intervalSec += 5;
      } else if (pollResponse.error === 'access_denied') {
        return { status: 'access_denied' };
      } else if (pollResponse.error === 'expired_token') {
        return { status: 'expired' };
      } else {
        return {
          status: 'error',
          message: `${pollResponse.error}: ${pollResponse.error_description ?? 'unknown'}`,
        };
      }
    }

    await sleep(intervalSec * 1000);
  }

  return { status: 'timeout' };
}

/**
 * Print a QR code to the terminal (falls back to URL if qrcode-terminal is unavailable).
 */
export async function printQrCode(url: string): Promise<void> {
  try {
    const qrcodeTerminal = await import(/* @vite-ignore */ 'qrcode-terminal');
    await new Promise<void>((resolve) => {
      qrcodeTerminal.default.generate(url, { small: true }, (qr: string) => {
        process.stdout.write(qr.endsWith('\n') ? qr : `${qr}\n`);
        resolve();
      });
    });
  } catch {
    console.log('Open this URL in a browser to scan:\n');
    console.log(url);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
