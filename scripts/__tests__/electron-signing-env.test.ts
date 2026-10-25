import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadElectronSigningEnv } from '../electron-signing-env.mjs';

const roots: string[] = [];
function fixture(contents: string) {
  const root = mkdtempSync(join(tmpdir(), 'xopc-signing-env-test-'));
  roots.push(root);
  writeFileSync(join(root, '.env.local'), contents);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('loads signing aliases from the repository root without unrelated local secrets', () => {
  const result = loadElectronSigningEnv(fixture('XOPC_APPLE_ID=fixture@example.invalid\nXOPC_APPLE_APP_SPECIFIC_PASSWORD=fixture-password\nXOPC_APPLE_TEAM_ID=FIXTURE123\nOTHER_API_KEY=unrelated'), {});
  expect(result).toMatchObject({ APPLE_ID: 'fixture@example.invalid', APPLE_APP_SPECIFIC_PASSWORD: 'fixture-password', APPLE_TEAM_ID: 'FIXTURE123' });
  expect(result.OTHER_API_KEY).toBeUndefined();
});
it('prefers explicit CI settings, then inherited aliases, over local credentials', () => {
  const root = fixture('APPLE_ID=local@example.invalid\nXOPC_APPLE_TEAM_ID=LOCAL12345');
  expect(loadElectronSigningEnv(root, { APPLE_ID: 'ci@example.invalid', XOPC_APPLE_ID: 'alias@example.invalid', XOPC_APPLE_TEAM_ID: 'CI12345678' })).toMatchObject({ APPLE_ID: 'ci@example.invalid', APPLE_TEAM_ID: 'CI12345678' });
});
it('supports standard API-key and Keychain settings without changing the input environment', () => {
  const env = { APPLE_KEYCHAIN_PROFILE: 'notary-fixture', PATH: '/usr/bin' };
  const result = loadElectronSigningEnv(fixture('APPLE_API_KEY=/fixture/AuthKey.p8\nAPPLE_API_KEY_ID=FIXTUREKEY\nAPPLE_API_ISSUER=fixture-issuer'), env);
  expect(result).toMatchObject({ ...env, APPLE_API_KEY: '/fixture/AuthKey.p8', APPLE_API_KEY_ID: 'FIXTUREKEY', APPLE_API_ISSUER: 'fixture-issuer' });
  expect(env).toEqual({ APPLE_KEYCHAIN_PROFILE: 'notary-fixture', PATH: '/usr/bin' });
});
it('keeps builds without local signing configuration supported', () => {
  expect(loadElectronSigningEnv(join(tmpdir(), 'xopc-missing-signing-config'), { PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
});
it('keeps Windows credentials separate from generic macOS certificates', () => {
  const root = fixture('CSC_LINK=mac.p12\nXOPC_CSC_KEY_PASSWORD=mac-password\nXOPC_WIN_CSC_LINK=windows.pfx\nXOPC_WIN_CSC_KEY_PASSWORD=windows-password\nXOPC_WINDOWS_PUBLISHER=CN=Fixture');
  expect(loadElectronSigningEnv(root, {}, 'win32')).toMatchObject({ CSC_LINK: 'windows.pfx', CSC_KEY_PASSWORD: 'windows-password', XOPC_WINDOWS_PUBLISHER: 'CN=Fixture' });
  expect(loadElectronSigningEnv(fixture('CSC_LINK=mac.p12'), { CSC_LINK: 'ci-mac.p12' }, 'win32').CSC_LINK).toBeUndefined();
  expect(loadElectronSigningEnv(root, {}, 'darwin').CSC_LINK).toBe('mac.p12');
});
