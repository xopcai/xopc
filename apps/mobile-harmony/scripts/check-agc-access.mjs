import { agcRequest } from './agc-auth.mjs';

async function main() {
  const appId = process.env.HUAWEI_AGC_APP_ID;
  if (!/^\d{1,32}$/.test(appId ?? '')) throw new Error('Set HUAWEI_AGC_APP_ID to the numeric AGC app ID.');

  // This POST only queries version metadata. It does not create or submit a version.
  const data = await agcRequest('/api/publish/v3/version/brief-info/list', {
    method: 'POST',
    headers: { appId },
    body: { packageName: 'ai.xopc.xopc' },
    label: 'AGC version query',
  });
  if (!Array.isArray(data.versionList)) throw new Error('AGC version query did not return a version list.');
  console.log(`AGC authentication verified for xopc. Found ${data.versionList.length} version(s).`);
}

await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
