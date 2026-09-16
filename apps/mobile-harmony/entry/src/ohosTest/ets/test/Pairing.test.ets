import { describe, it, expect } from '@ohos/hypium';
import { http } from '@kit.NetworkKit';
import { abilityDelegatorRegistry } from '@kit.TestKit';
import { XopcGatewaySession } from '../../../main/ets/service/gatewaySession';
import { XopcDeviceCrypto } from '../../../main/ets/service/deviceCrypto';
import { XopcSecureStore, fromUtf8 } from '../../../main/ets/service/secureStore';
import { XopcTransport, XopcHttpError } from '../../../main/ets/service/transport';

class IsolatedStore extends XopcSecureStore {
  private prefix: string;
  constructor(prefix: string) { super(); this.prefix = prefix; }
  async read(key: string): Promise<string | undefined> { return super.read(this.prefix + key); }
  async write(key: string, value: string): Promise<void> { return super.write(this.prefix + key, value); }
  async remove(key: string): Promise<void> { return super.remove(this.prefix + key); }
}

// This CA override exists only in the ohosTest HAP, never in production transport.
class LocalTestTransport extends XopcTransport {
  private ca: string;
  constructor(ca: string) { super(); this.ca = ca; }
  async request(origin: string, path: string, method: string = 'GET', body: string = '', token: string = ''): Promise<string> {
    if (origin !== 'https://127.0.0.1:9443') throw new Error('TEST_ORIGIN_REQUIRED');
    const connection = http.createHttp();
    try {
      const options: http.HttpRequestOptions = {
        method: http.RequestMethod.GET, customMethod: method, caData: this.ca,
        header: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
        expectDataType: http.HttpDataType.STRING, connectTimeout: 5000, readTimeout: 10000,
        maxRedirects: 0, usingCache: false
      };
      if (body) options.extraData = body;
      const response = await connection.request(origin + path, options);
      if (response.responseCode !== 200) throw new XopcHttpError(response.responseCode);
      return response.result as string;
    } finally { connection.destroy(); }
  }
}

interface TestInvitation { link: string; }
interface TestIdentity { deviceId: string; platform: string; }

export default function pairingTest(): void {
  describe('XopcNativePairing', (): void => {
    it('pairsOverTlsWithNativeCryptoAndRestoresRotatingCredentials', 0, async (): Promise<void> => {
      // TestKit supplies its legacy context wrapper, not a Stage context accepted by application.createModuleContext.
      const context = abilityDelegatorRegistry.getAbilityDelegator().getAppContext().createModuleContext('entry_test');
      const ca = fromUtf8(await context.resourceManager.getRawFileContent('native-test-ca.pem'));
      expect(ca.includes('BEGIN CERTIFICATE')).assertTrue();
      const transport = new LocalTestTransport(ca);
      const prefix = 'native-pair-' + new XopcDeviceCrypto().uuid() + '-';
      const keyAlias = prefix + 'key';
      const store = new IsolatedStore(prefix);
      let session = new XopcGatewaySession(store, new XopcDeviceCrypto(keyAlias), transport);
      try {
        const invitation = JSON.parse(await transport.request('https://127.0.0.1:9443', '/api/test/invitation')) as TestInvitation;
        const profile = await session.pair(invitation.link, (_code: string): void => {});
        let identity = JSON.parse(await session.request('/api/test/auth')) as TestIdentity;
        expect(identity.deviceId).assertEqual(profile.deviceId);
        expect(identity.platform).assertEqual('harmonyos');
        expect(await store.read('pairing')).assertUndefined();
        const refresh = await store.read('refresh');
        session = new XopcGatewaySession(store, new XopcDeviceCrypto(keyAlias), transport);
        expect((await session.restore())?.deviceId).assertEqual(profile.deviceId);
        identity = JSON.parse(await session.request('/api/test/auth')) as TestIdentity;
        expect(identity.deviceId).assertEqual(profile.deviceId);
        expect(await store.read('refresh') === refresh).assertFalse();
        expect(await store.read('refresh-attempt')).assertUndefined();
      } finally {
        await session.disconnect(); await store.remove('pairing');
        await new XopcSecureStore().remove(keyAlias);
      }
    }, 60000);
  });
}
