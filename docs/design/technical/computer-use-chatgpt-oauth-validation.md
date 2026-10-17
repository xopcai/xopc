# ChatGPT OAuth Computer Use validation

Validated on macOS on 2026-10-17 using xopc's existing `openai` ChatGPT OAuth binding and `openai/gpt-6.1-sol`. The validation did not use an API key or credentials from Codex App/CLI.

## Verified behavior

The successful run made three real model requests:

1. Read the label `Continue` from a synthetic PNG.
2. Propose a click whose screenshot coordinates fall inside the synthetic button.
3. Observe the disposable native `XopcComputerFixture` window and propose a native `activate` action for its Continue button.

The existing `ComputerBroker` and pinned Cua driver `0.28.2` executed the final action. The broker confirmed completed dispatch, and the subsequent native observation contained `PASS: Continue clicked`. Both target identity and state digest were unchanged during the pre-dispatch check. The fixture was closed after validation; no personal screenshots were sent or retained, and no user configuration was changed.

An earlier native attempt was refused with `COMPUTER_OBSERVATION_CHANGED` before any input was dispatched. The guard was retained. The successful run used the same 120-second action-envelope deadline as `ComputerRuntime`, rather than the test harness's initial 10-second deadline.

## Electron dev Gateway follow-up

After enabling the macOS permissions for the actual Electron dev host, the same model passed a complete live Gateway session. Both the conversation model and Computer Use model were `openai/gpt-6.1-sol`, with the OpenAI credential mode confirmed as OAuth. A temporary conversation was materialized through the authenticated session API and bound to the connected dev desktop. The agent used the production `computer_use` tool through Gateway REST and the desktop realtime bridge.

The retained Computer Use report recorded three observations, two GUI model requests, one proposed input, one completed native `activate` input, zero unknown dispatches, and a released control session. The specified accessibility text condition was satisfied after dispatch and again during independent observation. A separate inspection of the fixture confirmed `PASS: Continue clicked`. The fixture was closed and the previous global Computer Use model restored after the test.

The standalone dev Gateway initially timed out before any desktop input because its process lacked the machine's existing proxy configuration. Restarting that Gateway with `HTTP_PROXY` / `HTTPS_PROXY` pointing to the existing local proxy and `NO_PROXY` covering loopback resolved the real requests. The Gateway now also supports a persisted `gateway.outboundProxy` setting under Settings → Local service → Network. A follow-up run saved a custom local HTTP proxy, restarted the dev Gateway with all HTTP proxy environment variables removed, and received `PROXY_OK` from a real ChatGPT OAuth conversation. The same saved proxy also passed two hosted Computer Use requests: synthetic image recognition and a grounded action proposal. This follow-up did not execute native input.

## Fixes required by the real endpoint

The generic Responses function-tool adapter now sends `store: false` and `stream: true`. The OAuth endpoint explicitly rejected requests without these settings.

The stream reader accepts responses without a Content-Type header when streaming was requested. It reconstructs completed output items from `response.output_item.done` when the successful terminal response has an empty `output` array. No action is returned until `response.completed` confirms success. Failed, truncated, malformed or oversized streams are rejected; partial argument deltas never reach the broker.

These are stateless per-step function-tool calls. They do not require the provider's native `computer` tool or server-side response storage.

## Reproduction

Sign in through xopc's OpenAI provider first. The script refuses other active credential modes. Run the synthetic hosted checks with:

```bash
node --import tsx/esm scripts/verify-chatgpt-computer.mts openai/gpt-6.1-sol
```

Use the same proxy environment as the Gateway if required. This machine needed its existing local HTTP proxy; a direct Node request timed out. The script imports xopc's existing proxy dispatcher initialization.

For native verification, build and open the disposable application using `scripts/computer-fixture.swift` and `scripts/computer-fixture.Info.plist`, bundle the validation script as an Electron main-process entry, and pass `--native`. Set `XOPC_COMPUTER_DRIVER_BINARY` to the verified pinned driver binary. Existing macOS Accessibility and Screen Recording permissions for Electron are required. The harness grants only its fixture session and accepts only a click or native activation action; the fixture has no files, accounts or network operations. Close the fixture after the test.

The final JSON report includes the model, credential mode, request count, native dispatch and verified fixture state without tokens, screenshots, window contents or model prose. Optional `XOPC_COMPUTER_DIAGNOSTICS=1` reports only terminal output item types, tool names and argument lengths.

This establishes one real OAuth model and one native button interaction. The follow-up also covers the live Gateway network route in Electron dev. Neither run certifies every catalog model, unattended execution, or the packaged application UI.
