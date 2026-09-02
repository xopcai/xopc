# Session sharing

XOPC can publish an immutable, read-only snapshot of a Session. Open a conversation and choose **Share conversation** in the header, then select **XOPC Hosted Share** or **Local Gateway Share**.

## Snapshot boundary

The default snapshot contains only visible user and assistant text. It never includes system prompts, reasoning, tool arguments or results, shell command text or output, context rows, workspace paths, Session keys, or model metadata.

Before publishing, the owner may explicitly include:

- tool activity names and success/failure states; and
- individual Session attachments.

Selected attachments never expose the original media store. Local delivery copies them into a private local artifact; hosted delivery uploads the reviewed files by checksum into private storage. Each public asset request requires a short-lived ticket bound to the share revision.

The preview fingerprint covers the active `sessionId`, transcript cutoff sequence, and Session metadata update timestamp. XOPC rejects creation or refresh when the Session changes after the owner reviews the preview.

## Link lifecycle

- Later messages are not added automatically.
- **Update to current conversation** replaces the snapshot while keeping the same URL.
- Updating increments the snapshot revision and invalidates old asset tickets.
- Expiration, maximum views, revocation, and rate limiting are enforced by the selected delivery service.

The public page is available at `/s/:token`. Metadata and social-card requests do not consume a view; `POST /s/:token/view` atomically claims one view.

## Reachability

Hosted links use `https://share.xopc.ai` and remain available while the owner's Gateway and device are offline. The first hosted publish asks the owner to authorize the isolated `xopc-share` OAuth resource with `shares:read` and `shares:write`; model and tunnel credentials are not reused. Set `XOPC_SHARE_URL` only when developing against another Hosted Share deployment.

Local Gateway links keep the previous behavior: remote access requires a public tunnel or `gateway.publicUrl`; loopback produces a local-only link and LAN binding produces a LAN-only link. XOPC never converts a local link to hosted delivery implicitly.
