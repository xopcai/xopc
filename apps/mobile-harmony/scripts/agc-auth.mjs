import { constants, createPrivateKey, sign } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const AGC_ORIGIN = 'https://connect-api.cloud.huawei.com';

export function agcAuthHeaders(env = process.env) {
  const credentialJson = env.HUAWEI_AGC_SERVICE_ACCOUNT_JSON;
  if (!credentialJson) {
    if (!env.HUAWEI_AGC_ACCESS_TOKEN) {
      throw new Error('Set HUAWEI_AGC_SERVICE_ACCOUNT_JSON or HUAWEI_AGC_ACCESS_TOKEN.');
    }
    return {
      Authorization: `Bearer ${env.HUAWEI_AGC_ACCESS_TOKEN}`,
      ...(env.HUAWEI_AGC_CLIENT_ID ? { client_id: env.HUAWEI_AGC_CLIENT_ID } : {}),
    };
  }

  let credential;
  try {
    credential = JSON.parse(credentialJson);
  } catch {
    throw new Error('HUAWEI_AGC_SERVICE_ACCOUNT_JSON must contain Huawei’s credential JSON.');
  }
  const { key_id: kid, sub_account: iss, private_key: privateKey } = credential ?? {};
  if ([kid, iss, privateKey].some((value) => typeof value !== 'string' || !value)) {
    throw new Error('Huawei credential JSON must include key_id, sub_account and private_key.');
  }

  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const header = encode({ kid, typ: 'JWT', alg: 'PS256' });
  const payload = encode({ aud: 'https://oauth-login.cloud.huawei.com/oauth2/v3/token', iss, iat, exp: iat + 3600 });
  const message = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(message), {
    key: createPrivateKey(privateKey),
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return { Authorization: `Bearer ${message}.${signature.toString('base64url')}` };
}

export async function agcRequest(path, { method = 'GET', headers, body, label, retry = false, appTest = false }) {
  const url = new URL(path, AGC_ORIGIN);
  if (url.origin !== AGC_ORIGIN) throw new Error('Invalid Huawei Connect API path.');
  const options = {
    method,
    redirect: 'error',
    headers: { ...agcAuthHeaders(), ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  let response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    if (!retry || attempt >= 2 || (response && response.status !== 429 && response.status < 500)) break;
    await response?.body?.cancel().catch(() => {});
    await delay(1000 * 2 ** attempt);
  }
  if (!response) throw new Error(`${label} did not return an HTTP response.`);
  if (!response.ok) throw new Error(`${label} failed (HTTP ${response.status}).`);
  const data = await response.json().catch(() => { throw new Error(`${label} returned invalid JSON.`); });
  const code = appTest ? data?.rtnCode : data?.ret?.code;
  if (code !== 0 && code !== '0') {
    throw new Error(`${label} failed (service code ${/^-?\d+$/.test(code) ? code : 'unknown'}).`);
  }
  return data;
}
