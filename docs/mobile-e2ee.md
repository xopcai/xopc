# Mobile application-layer E2EE (`xopc-e2ee-v1`)

Remote tunnel traffic is TLS-terminated at the broker (`*.frp.xopc.ai`). Application-layer E2EE keeps request and response bodies confidential from broker/nginx loopback inspection.

## Overview

| Layer | Scope |
|-------|--------|
| Transport TLS | Broker wildcard cert on `*.frp.xopc.ai` |
| App E2EE | AES-256-GCM envelopes + stream frames after pairing handshake |

Shared crypto lives in `@xopcai/xopc-e2ee` (xopc monorepo + xopc-app workspace copy).

## Handshake (after pairing)

1. Mobile scans QR / exchanges `ps` → `POST /api/tunnel/exchange-token` (returns `e2ee.gatewayPub`, `e2ee.fingerprint`).
2. Mobile generates X25519 device key + `sessionId`.
3. `POST /api/e2ee/handshake` (Bearer token) with `{ sessionId, devicePub, pairingSecret }`.
4. Gateway derives session root key (ECDH + HKDF, optional `pairingSecret` binding) and returns `{ serverConfirm, expiresAt }`.
5. Mobile verifies `HMAC-SHA256(rootKey, "xopc-e2ee-server-confirm") === serverConfirm`.
6. Session keys (`req` / `res` / `stream`) stored in MMKV (~24h TTL).

## REST relay

Remote API calls use `POST /api/e2ee/relay`:

```json
{
  "sessionId": "...",
  "seq": 1,
  "method": "GET",
  "path": "/api/sessions",
  "envelope": { "v": 1, "seq": 1, "nonce": "...", "ciphertext": "..." }
}
```

Gateway decrypts, forwards to the internal route, encrypts the JSON response envelope.

## Streaming (agent + broadcast SSE)

Long-lived SSE endpoints use `POST /api/e2ee/relay-stream` with the same envelope shape as REST relay. Response is `text/event-stream` where each `data:` line is a base64url E2EE frame (length-prefixed AES-GCM).

Each relay-stream derives an independent stream key from `(rootKey, requestSeq)` so broadcast `/api/events` and agent `/api/agent` can run **concurrently** on FRP without sharing one global stream sequence.

| Endpoint | Method | Client |
|----------|--------|--------|
| `/api/agent`, `/api/agent/resume` | POST | xopc-app agent chat |
| `/api/events` | GET | xopc-app gateway broadcast SSE |

Direct `GET /api/events` on `*.frp.xopc.ai` is blocked by broker nginx (403). Mobile must use relay-stream on remote tunnel URLs; LAN may connect directly.

## Policy

When tunnel is connected and the request `Host` matches the tunnel subdomain:

- Non-exempt paths without E2EE relay return **426** `E2EE_REQUIRED`.
- Exempt: `/health`, `/api/tunnel/pair/*`, `/api/tunnel/exchange-token`, `/api/e2ee/*`.

Config (`xopc.json`):

```json
{
  "tunnel": {
    "appE2ee": {
      "enabled": true,
      "requiredOnRemote": true
    }
  }
}
```

LAN HTTP access does not require E2EE when `requiredOnRemote` is true (default).

Gateway persists E2EE sessions under `{stateDir}/e2ee/sessions/` (~24h TTL) so a process restart does not invalidate active mobile sessions. Clients still renew on `401` (`renewE2eeSession`).

## Broker hardening

Nginx wildcard vhost allows only:

- `/health`, `/api/health`
- `/api/tunnel/pair`, `/api/tunnel/pair/*`
- `/api/tunnel/exchange-token`
- `/api/e2ee/*`

All other paths return 403 at the edge. Full gateway API is reachable only through E2EE relay after pairing.

Well-known advertises:

```json
{
  "transport": {
    "tls": "broker_terminated",
    "publicScheme": "https",
    "requiresAppE2ee": true
  }
}
```

## Rollout order

1. Deploy broker Phase 6 nginx (wildcard TLS terminate → frps HTTP).
2. Release xopc without local ACME (`frpc type=http`).
3. Release xopc-app with E2EE handshake + relay.
4. Enable broker pairing-only ACL + `requiresAppE2ee: true`.

Older mobile builds receive 426 on remote API calls — upgrade required.

## Verification

```bash
# Broker TLS (from gateway host or CI)
TUNNEL_PUBLIC_URL=https://{sub}.frp.xopc.ai pnpm run tunnel:phase6:verify

# Crypto vectors
pnpm -C packages/xopc-e2ee test
```

Pair on device → confirm chat works over tunnel URL (not LAN). Inspect broker/nginx access logs: agent bodies should not appear as plaintext JSON (only E2EE relay paths).
