# Mobile device request security

Device request proof v1 protects paired-device API requests and native realtime connections. It uses the existing P-256 device identity. Owner bearer tokens and browser-cookie authentication retain their existing behavior. Public FRP endpoints must use HTTPS/WSS; signatures do not encrypt payloads or authenticate unsigned responses.

## Activation and compatibility

Deploy the gateway before the mobile applications. Android, iOS and HarmonyOS negotiate `requestProofVersion: 1` during the existing signed device-refresh exchange. This field is covered by the refresh signature. The gateway atomically persists a monotonic device proof requirement and revokes previously issued access tokens on first activation. It then issues the new tokens in a gateway-signed response. A later refresh cannot downgrade that device. Lost-response refresh retries retain their existing rotation/idempotency mechanism.

Existing devices remain in legacy mode until a new client successfully refreshes. This preserves access during a staged rollout, but those devices do not yet have proof-of-possession protection. Device management displays the status. An upgraded device requires an upgraded client thereafter; rolling back only the mobile application is not supported. Back up the database before deployment; migration 244 adds a device column and a nonce table. No global force-upgrade toggle is introduced.

## HTTP proof

`X-Xopc-Proof` is `timestamp.nonce.bodySha256.signature`, using Unix milliseconds, a random base64url nonce, lowercase SHA-256 hex and a base64url IEEE-P1363 ECDSA signature. The signed UTF-8 message joins the following fields with LF, without a trailing LF:

1. `xopc-request-v1`
2. Gateway identity ID
3. SHA-256 of the exact bearer credential
4. HTTP method
5. Encoded pathname and raw query, including query ordering
6. SHA-256 of the exact transmitted body (empty bytes for a bodyless request)
7. Content-Type
8. Idempotency-Key
9. X-Xopc-Expected-Session-Key
10. X-Endpoint-Id
11. X-Endpoint-Upload-Token
12. Timestamp
13. Nonce

Missing header fields are empty strings. Client wrappers finalize request headers and body before signing, including multipart boundaries. The server checks the signature before reading the body, hashes a clone of the request to preserve Hono multipart parsing, then atomically inserts the nonce before business effects. SQLite uniqueness rejects parallel duplicates and preserves protection across process restarts. The timestamp window is ±120 seconds; nonce expiry uses the submitted timestamp plus the window so future-dated accepted requests remain protected. Signed gateway identity challenges supply a server-time offset; clients cache route verification for 30 seconds.

Nonce storage is capped at 100,000 active records and cleaned at most once per 30 seconds; exhaustion rejects requests. Nonces prevent request replay, not duplicate user actions: business idempotency still owns mutation retry semantics. Any new HTTP attempt must use a new proof; automatically resending the same mutation is not introduced.

## Realtime and voice

Native WebSocket upgrade headers carry the same proof format, with method `CONNECT`, exact pathname/query, empty body/header fields and the ticket as credential. This covers both direct voice paths and the realtime voice proxy query. Validation precedes ticket consumption. Existing ticket acquisition and hello/session-start frames remain in place. There is no new network round trip and no per-frame ECDSA signature on chat events or audio packets; transport encryption and existing session ownership remain necessary.

Android signs connection requests on an IO dispatcher and caches its Keystore key handle. All three clients reuse the existing device key. No per-request key generation is performed.

## Admission limits and information exposure

Public pairing, identity and refresh routes have independent family budgets: 1,200 requests/minute globally and 300/minute per resolved source. Forwarded addresses are used only according to trusted-proxy configuration. Identity signing has an additional 300/minute global budget; verified refresh requests have a 30/minute per-device budget. Limit failures return 429 with Retry-After. Public budgets do not consume authenticated chat/media buckets. FRP deployments without trustworthy client-IP forwarding share a source bucket; these limits cannot ensure availability against upstream bandwidth exhaustion.

Signed uploads or requests with declared bodies over 64 KiB have a verification/concurrency budget of 8 per device and 16 globally, held through handler completion. Existing route body-size limits still apply. Hashing/buffering large uploads remains linear in payload size and needs measurement on target hardware. Existing small interactive JSON requests are outside this upload budget.

Public `/health` and `/api/health` return only status/readiness. Logs redact signature/proof fields and textual proof headers. Tunnel Broker URLs must use HTTPS without URL user credentials.

## Validation and RT evidence

Tests cover signature tampering, credential/audience/query/header/body binding, clock windows, durable replay rejection, concurrent HTTP replay, signed activation and downgrade rejection, multipart compatibility, public admission limits and log redaction. The shared public-key/P1363 vector in `packages/gateway-contract/test-fixtures/device-request-proof-v1.json` is verified on Node, Java, Swift and Harmony host tests. It contains no private key.

Run the reproducible local benchmark with:

```sh
XOPC_LOG_LEVEL=fatal pnpm exec tsx scripts/bench-device-request-proof.ts
```

It compares alternating legacy/signed 1 KiB HTTP requests over loopback with SQLite default durability and reports Node signing separately. It does not measure phone Keystore latency, public FRP latency, radio handovers, audio jitter or large uploads. Before production rollout, verify physical-device message send/first-event latency, voice connection/reconnection, sustained audio, uploads and route fallback against the deployed TLS/FRP path. Changes are implemented in the repository; deployment and physical-device acceptance are separate steps.

Local result on 2026-10-11 (270 measured requests per variant after warmup):

| Measurement | P50 (ms) | P95 (ms) |
| --- | ---: | ---: |
| Legacy HTTP | 0.227 | 0.375 |
| Signed HTTP | 0.384 | 0.580 |
| Node client signing | 0.024 | 0.044 |

These percentile differences are aggregate comparisons, not paired per-request overhead guarantees.
