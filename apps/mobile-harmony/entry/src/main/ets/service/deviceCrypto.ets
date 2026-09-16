import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { util } from '@kit.ArkTS';
import { decodeBase64Url, encodeBase64Url, fixedIntegerBytes } from '../common/protocol';
import { XopcPublicKey, XopcSignedEnvelope } from '../model/gateway';
import { XopcSecureStore, utf8, fromUtf8 } from './secureStore';

interface XopcStoredKey { privateKey: string; publicKey: string; }

export class XopcDeviceCrypto {
  private store: XopcSecureStore = new XopcSecureStore();
  private keyTask?: Promise<cryptoFramework.KeyPair>;
  private alias: string;

  constructor(alias: string = 'device-key') { this.alias = alias; }

  async clearKey(): Promise<void> {
    if (this.keyTask) { try { await this.keyTask; } catch (_) { /* A failed key load has no usable identity. */ } }
    await this.store.remove(this.alias);
    this.keyTask = undefined;
  }

  private async loadKey(): Promise<cryptoFramework.KeyPair> {
    const generator = cryptoFramework.createAsyKeyGenerator('ECC256');
    const stored = await this.store.read(this.alias);
    if (stored) {
      const saved = JSON.parse(stored) as XopcStoredKey;
      return generator.convertKey({ data: decodeBase64Url(saved.publicKey) }, { data: decodeBase64Url(saved.privateKey) });
    }
    const key = await generator.generateKeyPair();
    const saved: XopcStoredKey = {
      privateKey: encodeBase64Url(key.priKey.getEncoded().data), publicKey: encodeBase64Url(key.pubKey.getEncoded().data)
    };
    await this.store.write(this.alias, JSON.stringify(saved));
    return key;
  }

  private key(): Promise<cryptoFramework.KeyPair> {
    if (!this.keyTask) this.keyTask = this.loadKey().catch((error: Error): Promise<cryptoFramework.KeyPair> => {
      this.keyTask = undefined;
      return Promise.reject<cryptoFramework.KeyPair>(error);
    });
    return this.keyTask;
  }

  async publicKey(): Promise<XopcPublicKey> {
    const key = (await this.key()).pubKey;
    const x = key.getAsyKeySpec(cryptoFramework.AsyKeySpecItem.ECC_PK_X_BN) as bigint;
    const y = key.getAsyKeySpec(cryptoFramework.AsyKeySpecItem.ECC_PK_Y_BN) as bigint;
    return { kty: 'EC', crv: 'P-256', x: encodeBase64Url(fixedIntegerBytes(x, 32)), y: encodeBase64Url(fixedIntegerBytes(y, 32)) };
  }

  async publicKeyDer(): Promise<string> { return encodeBase64Url((await this.key()).pubKey.getEncoded().data); }

  async sign(message: string): Promise<string> {
    const signer = cryptoFramework.createSign('ECC256|SHA256');
    await signer.init((await this.key()).priKey);
    const signature = cryptoFramework.SignatureUtils.genEccSignatureSpec((await signer.sign({ data: utf8(message) })).data);
    const bytes = new Uint8Array(64);
    bytes.set(fixedIntegerBytes(signature.r, 32)); bytes.set(fixedIntegerBytes(signature.s, 32), 32);
    return encodeBase64Url(bytes);
  }

  async verify(publicKey: string, envelope: XopcSignedEnvelope): Promise<string> {
    if (!envelope || typeof envelope.signedPayload !== 'string' || typeof envelope.signature !== 'string') throw new Error('GATEWAY_IDENTITY_MISMATCH');
    const raw = decodeBase64Url(publicKey);
    if (raw.length !== 32) throw new Error('INVALID_GATEWAY_KEY');
    const der = new Uint8Array(44);
    der.set([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
    der.set(raw, 12);
    const key = await cryptoFramework.createAsyKeyGenerator('Ed25519').convertKey({ data: der }, null);
    const verifier = cryptoFramework.createVerify('Ed25519');
    await verifier.init(key.pubKey);
    if (!await verifier.verify({ data: utf8(envelope.signedPayload) }, { data: decodeBase64Url(envelope.signature) })) {
      throw new Error('GATEWAY_IDENTITY_MISMATCH');
    }
    return fromUtf8(decodeBase64Url(envelope.signedPayload));
  }

  async nonce(length: number = 24): Promise<string> {
    return encodeBase64Url((await cryptoFramework.createRandom().generateRandom(length)).data);
  }

  uuid(): string { return util.generateRandomUUID(true); }
  async refreshToken(): Promise<string> { return 'xopc_rt_' + this.uuid() + '_' + await this.nonce(32); }
}
