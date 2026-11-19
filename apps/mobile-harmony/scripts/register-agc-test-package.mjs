import { setTimeout as delay } from 'node:timers/promises';

import { agcRequest } from './agc-auth.mjs';

export async function registerAgcTestPackage(appId, objectId, fileName) {
  if (!objectId || objectId.length > 512 || !/^[^/\\]{1,251}\.app$/.test(fileName ?? '')) {
    throw new Error('Usage: register-agc-test-package.mjs register OBJECT_ID FILE_NAME.app');
  }
  const data = await agcRequest(`/api/publish/v2/test/version/pkg?${new URLSearchParams({ appId })}`, {
    method: 'POST',
    body: { distributeMode: 1, file: { objectId, fileName } },
    label: 'AGC test package registration',
  });
  const [pkgId] = data.pkgVersion ?? [];
  if (typeof pkgId !== 'string' || !/^[\w-]{1,64}$/.test(pkgId)) throw new Error('AGC did not return a package ID.');
  return pkgId;
}

export async function waitAgcTestPackage(appId, pkgId) {
  if (typeof pkgId !== 'string' || !/^[\w-]{1,64}$/.test(pkgId)) throw new Error('A valid AGC package ID is required.');
  console.log(`AGC test package ID: ${pkgId}`);
  const path = `/api/publish/v3/package/compile/status?${new URLSearchParams({ appId, pkgIds: pkgId })}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const data = await agcRequest(path, { label: 'AGC package parsing status', retry: true });
    const state = data.pkgStateList?.find((item) => item.pkgId === pkgId);
    if (state?.successStatus === 0) {
      console.log('Huawei accepted the test package.');
      return;
    }
    if (state && state.successStatus !== 1) {
      const code = /^\d+$/.test(state.errorCode) ? state.errorCode : 'unknown';
      throw new Error(`Huawei could not parse package ${pkgId} (service code ${code}).`);
    }
    if (attempt < 39) await delay(15_000);
  }
  throw new Error(`Huawei is still processing package ${pkgId}. Run the wait command with this package ID to resume.`);
}

if (import.meta.main) {
  try {
    const appId = process.env.HUAWEI_AGC_APP_ID;
    if (!/^\d{1,32}$/.test(appId ?? '')) throw new Error('Set HUAWEI_AGC_APP_ID to the numeric AGC app ID.');
    const [operation, value, fileName] = process.argv.slice(2);
    if (operation === 'register') {
      await waitAgcTestPackage(appId, await registerAgcTestPackage(appId, value, fileName));
    } else if (operation === 'wait' && fileName === undefined) {
      await waitAgcTestPackage(appId, value);
    } else {
      throw new Error('Usage: register-agc-test-package.mjs wait PACKAGE_ID');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
