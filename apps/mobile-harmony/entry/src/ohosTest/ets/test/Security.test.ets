import { describe, it, expect } from '@ohos/hypium';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { XopcDeviceCrypto } from '../../../main/ets/service/deviceCrypto';
import { XopcSecureStore, utf8 } from '../../../main/ets/service/secureStore';
import { decodeBase64Url } from '../../../main/ets/common/protocol';
import { XopcSignedEnvelope } from '../../../main/ets/model/gateway';

export default function securityTest(): void {
  describe('XopcNativeSecurity', (): void => {
    it('secureStorageRoundTrip', 0, async (): Promise<void> => {
      const store = new XopcSecureStore();
      const alias = 'instrument-' + new XopcDeviceCrypto().uuid();
      try {
        expect(await store.read(alias)).assertUndefined();
        await store.write(alias, '中文 secret');
        expect(await store.read(alias)).assertEqual('中文 secret');
        await store.write(alias, 'updated');
        expect(await store.read(alias)).assertEqual('updated');
        const journal = '鸿蒙🌟'.repeat(2000);
        await store.write(alias, journal);
        expect(await store.read(alias)).assertEqual(journal);
        await store.write(alias, 'short');
        expect(await store.read(alias)).assertEqual('short');
        await store.write(alias, '');
        expect(await store.read(alias)).assertEqual('');
      } finally { await store.remove(alias); }
      expect(await store.read(alias)).assertUndefined();
    });

    it('p256CompactSignAndRestore', 0, async (): Promise<void> => {
      const alias = 'instrument-key-' + new XopcDeviceCrypto().uuid();
      try {
        const signer = new XopcDeviceCrypto(alias);
        const jwk = await signer.publicKey();
        const der = await signer.publicKeyDer();
        const restored = new XopcDeviceCrypto(alias);
        expect(JSON.stringify(await restored.publicKey())).assertEqual(JSON.stringify(jwk));
        const compact = decodeBase64Url(await restored.sign('xopc-test'));
        expect(compact.length).assertEqual(64);
        let r = BigInt(0); let s = BigInt(0);
        for (let i = 0; i < 32; i++) { r = r * BigInt(256) + BigInt(compact[i]); s = s * BigInt(256) + BigInt(compact[i + 32]); }
        const spec: cryptoFramework.EccSignatureSpec = { r, s };
        const signature = cryptoFramework.SignatureUtils.genEccSignature(spec);
        const key = await cryptoFramework.createAsyKeyGenerator('ECC256').convertKey({ data: decodeBase64Url(der) }, null);
        const verifier = cryptoFramework.createVerify('ECC256|SHA256');
        await verifier.init(key.pubKey);
        expect(await verifier.verify({ data: utf8('xopc-test') }, { data: signature })).assertTrue();
        await restored.clearKey();
        expect(await new XopcSecureStore().read(alias)).assertUndefined();
        expect(JSON.stringify(await restored.publicKey()) === JSON.stringify(jwk)).assertFalse();
      } finally { await new XopcSecureStore().remove(alias); }
    });

    it('ed25519GatewayFixture', 0, async (): Promise<void> => {
      const crypto = new XopcDeviceCrypto();
      const key = 'j4_lHrVUtwWLxKl6_yU7Si-Q7W0H8z-iu-O2_mh3bDY';
      const envelope: XopcSignedEnvelope = {
        signedPayload: 'eyJwdXJwb3NlIjoiaGFybW9ueS1jb25mb3JtYW5jZSJ9',
        signature: 'eMqEBf0d8pYJE1P8B_BMUiaFuz0xNU-XSJg4KmiAqktyEezA-ag8y8ULq1N8Beqq4HCDxScK2g_7IdR5veWoCA'
      };
      expect(await crypto.verify(key, envelope)).assertEqual('{"purpose":"harmony-conformance"}');
      envelope.signedPayload += 'AA';
      let rejected = false;
      try { await crypto.verify(key, envelope); } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });
  });
}
