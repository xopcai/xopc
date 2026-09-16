export interface XopcRoute { id: string; kind: string; url: string; }
export interface XopcInvitation {
  version: number;
  targetKind: string;
  pairingToken: string;
  gatewayId: string;
  gatewayName: string;
  gatewayPublicKey: string;
  routes: XopcRoute[];
  expiresAt: number;
}
export interface XopcPublicKey { kty: string; crv: string; x: string; y: string; }
export interface XopcDevice { displayName: string; platform: string; publicKeyJwk: XopcPublicKey; }
export interface XopcPairingBody {
  gatewayId: string;
  requestId: string;
  pairingToken: string;
  timestamp: number;
  nonce: string;
  device?: XopcDevice;
  idempotencyKey?: string;
  initialRefreshToken?: string;
  signature?: string;
}
export interface XopcSignedEnvelope { signedPayload: string; signature: string; }
export interface XopcPairingStatus {
  requestId: string; status: string; confirmationCode: string;
  expiresAt: number; deviceId?: string;
}
export interface XopcGatewayIdentity { id: string; name: string; }
export interface XopcPairingResponse {
  request: XopcPairingStatus; gateway: XopcGatewayIdentity; nonce: string;
  routes?: XopcRoute[]; scopes?: string[];
}
export interface XopcProfile {
  gatewayId: string; name: string; gatewayPublicKey: string; deviceId: string;
  routes: XopcRoute[]; activeRouteId: string;
}
export interface XopcPairingJournal {
  invitation: XopcInvitation; requestId: string; idempotencyKey: string;
  initialRefreshToken: string; device: XopcDevice; origin: string;
}
export interface XopcTokens {
  accessToken: string; accessTokenExpiresAt: number;
  refreshToken: string; refreshTokenExpiresAt: number;
}
export interface XopcRefreshAttempt { refreshToken: string; nextRefreshToken: string; requestId: string; }
export interface XopcRefreshBody extends XopcRefreshAttempt { timestamp: number; nonce: string; signature: string; }
export interface XopcIdentityProof { purpose: string; gatewayId: string; nonce: string; expiresAt: number; }
export interface XopcRefreshProof extends XopcIdentityProof { requestId: string; tokens: XopcTokens; }
export interface XopcNonceBody { nonce: string; }
export interface XopcProbeBody { pairingId: string; }
export interface XopcProbeProof { gatewayId: string; pairingId: string; issuedAt: number; }
