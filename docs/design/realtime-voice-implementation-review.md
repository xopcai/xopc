# Realtime voice implementation review

Updated: 2026-09-05. Current delivery: persistent Chat context across calls.

The implemented product contract and current validation supersede the prior fresh-call interaction. See [phased delivery and self-review](./persistent-voice-delivery.md), [PRD](./realtime-voice-prd.md), [technical design](./realtime-voice-technical-design.md) and [protocol](./realtime-voice-websocket-protocol.md).

The existing Agent/native engines and protocol v2 remain distinct capabilities. This delivery changes call ownership, shared Chat context and setup in xopc. It removes the composer-owned conversation surface, output-only mute and instructions claiming that each call starts without history.

Validation reported for this delivery does not re-certify prior platform relay/billing work or prior paid-provider runs. No platform code, production credentials, published route or deployment was changed here.
