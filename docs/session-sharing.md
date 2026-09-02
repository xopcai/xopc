# Session sharing

XOPC can publish an immutable, read-only snapshot of a Session through the existing Share system. Open a conversation and choose **Share conversation** in the header.

## Snapshot boundary

The default snapshot contains only visible user and assistant text. It never includes system prompts, reasoning, tool arguments or results, shell command text or output, context rows, workspace paths, Session keys, or model metadata.

Before publishing, the owner may explicitly include:

- tool activity names and success/failure states; and
- individual Session attachments.

Selected attachments are copied into the share artifact. Public URLs never point at the original media store. Each asset request requires a short-lived ticket bound to the share revision.

The preview fingerprint covers the active `sessionId`, transcript cutoff sequence, and Session metadata update timestamp. XOPC rejects creation or refresh when the Session changes after the owner reviews the preview.

## Link lifecycle

- Later messages are not added automatically.
- **Update to current conversation** replaces the snapshot while keeping the same URL.
- Updating increments the snapshot revision and invalidates old asset tickets.
- Expiration, maximum views, revocation, rate limiting, audit logging, and share management use the common Share infrastructure.

The public page is available at `/s/:token`. Metadata and social-card requests do not consume a view; `POST /s/:token/view` atomically claims one view.

## Reachability

A share is only remotely accessible when the Gateway has a public tunnel or `gateway.publicUrl`. A loopback Gateway produces a local-only link, and a LAN-bound Gateway produces a LAN-only link. XOPC does not upload Session snapshots to a hosted service.
