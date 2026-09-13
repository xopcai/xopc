# Secure channel B0 experiment

Status: protocol experiment only; not imported by Gateway, Web, mobile, or browser extension. B0 acceptance is incomplete. No production secure endpoint or plaintext fallback is added here.

## Decision and scope

The experiment pins Snow 0.10.0 and `Noise_NK_25519_ChaChaPoly_BLAKE2s`, with only the needed algorithms enabled. NK assumes the initiator already knows the responder's channel public key. It does not authenticate the mobile device; the existing device proof and authorization must run inside the established encrypted channel. A future channel key must be bound to the already paired Gateway Ed25519 identity with a fresh signed certificate. The current experiment generates test keys and does not implement that certificate.

Use the library's handshake/transport state machine and nonce handling. Do not implement another cipher, key derivation, or retryable nonce counter. Each reconnect must create a fresh channel; application request replay/idempotency belongs above that channel. The [Noise specification](https://noiseprotocol.org/noise.html) defines the handshake and transport properties.

Snow is a candidate, not an approved production dependency: its [maintainer README](https://github.com/mcginty/snow) explicitly states that it has not received a formal audit. A passing vector is not an audit. The native/Node adapters and protocol integration require security review before a production selection.

## Reproduce

```sh
cargo test --locked --release --manifest-path experiments/secure-channel/Cargo.toml
```

Six tests cover a two-message NK exchange without credentials in early data; rejection of a wrong responder key; encrypted method/path/headers/body; rejection of corruption, replay, reordering and cross-session ciphertext; maximum frame limits; 100 MiB in bounded 32 KiB chunks interleaved with response frames. An independent Cacophony test vector checks exact handshake and transport bytes in both directions; provenance is in `VECTOR-SOURCE.txt`.

This is in-process desktop testing. It does not demonstrate actual REST streaming, WebSocket multiplexing, HTTP fallback, audio latency, mobile memory usage or network reconnection. The 100 MiB result is not an iOS/Android performance claim.

## Remaining B0 gates, in order

1. Select and review the production protocol implementation, licenses, native packaging and randomness/key-lifetime boundary. Build the same implementation for Node, iOS and Android; avoid parallel JS/native crypto implementations.
2. Bind a fresh Noise channel certificate to the existing Gateway identity, challenge, protocol version and allowed capabilities; validate it before sending credentials. Authenticate and authorize the device inside the channel. Reject downgrade and expired/replayed certificates.
3. Implement a single bounded encrypted record transport, with WS and HTTP carriers sharing it. Define cancellation, receive window/backpressure and fair scheduling so file transfer cannot starve voice. Encrypt path, headers, credentials and body; no credential-bearing query parameters.
4. Exercise real REST, WS event resumption, multipart/files, voice and HTTP carrier after WS blocking. Test dropped responses, duplicate submission, process restart, cancellation, revocation and replay. Side effects require durable application request IDs; reconnect must never replay an unsafe request implicitly.
5. Run iOS/Android builds and physical-device baseline comparisons under weak networks, background/resume and 100 MiB transfers. Meet the design's measured memory, p95 and handshake limits. Then review integration and decide B1 eligibility.

B1 (new-client rollout with persistent minimum security level) and B2 (default plus public private-API retirement) are not implemented. They must not be enabled based solely on these six tests. A-series TLS, browser cookies and identity challenges still trust the platform that terminates HTTPS.
