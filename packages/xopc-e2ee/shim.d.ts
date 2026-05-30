declare module '@xopcai/xopc-e2ee' {
  export const E2EE_VERSION: 1;
  export const E2EE_CONTENT_TYPE: string;

  export type E2eeEnvelope = {
    v: 1;
    seq: number;
    nonce: string;
    aad?: Record<string, unknown>;
    ciphertext: string;
  };

  export type DirectionKeys = {
    requestKey: CryptoKey;
    responseKey: CryptoKey;
    streamKey: CryptoKey;
  };

  export type X25519KeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };
  export type ExportedIdentity = {
    version: 1;
    publicKey: string;
    privateKey: string;
    createdAt: string;
  };

  export function bytesToBase64Url(bytes: Uint8Array): string;
  export function base64UrlToBytes(value: string): Uint8Array;
  export function utf8ToBytes(value: string): Uint8Array;
  export function bytesToUtf8(value: Uint8Array): string;

  export function generateX25519KeyPair(): Promise<X25519KeyPair>;
  export function exportIdentityKeyPair(pair: X25519KeyPair): Promise<ExportedIdentity>;
  export function loadIdentityKeyPair(identity: ExportedIdentity): Promise<X25519KeyPair>;
  export function fingerprintPublicKey(publicKey: Uint8Array): string;
  export function deriveSessionRootKey(params: {
    privateKey: Uint8Array;
    peerPublicKey: Uint8Array;
    sessionId: string;
    pairingSecret?: string;
  }): Promise<Uint8Array>;
  export function deriveDirectionKey(
    rootKey: Uint8Array,
    direction: 'req' | 'res' | 'stream',
  ): Promise<CryptoKey>;
  export function deriveRelayStreamKey(rootKey: Uint8Array, requestSeq: number): Promise<CryptoKey>;
  export function hmacSha256(key: Uint8Array, message: string): Promise<string>;

  export function encryptEnvelope(
    key: CryptoKey,
    seq: number,
    plaintext: string,
    aad?: Record<string, unknown>,
  ): Promise<E2eeEnvelope>;
  export function decryptEnvelope(key: CryptoKey, envelope: E2eeEnvelope): Promise<string>;
  export function buildDirectionKeys(rootKey: Uint8Array): Promise<DirectionKeys>;

  export function encryptFrame(key: CryptoKey, seq: number, plaintext: string): Promise<Uint8Array>;
  export function decryptFrame(key: CryptoKey, seq: number, frame: Uint8Array): Promise<string>;
  export function frameToBase64(frame: Uint8Array): string;
  export function frameFromBase64(value: string): Uint8Array;
}
