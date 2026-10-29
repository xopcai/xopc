# Phone Use GPT / ChatGPT OAuth live validation

Validated on 2026-10-29 (Asia/Shanghai) with `openai/gpt-6.1-sol` and xopc's existing OpenAI ChatGPT OAuth credentials. No API key, simulated model response or Codex App/CLI credential was used.

## Verified chain

The test used the registered **阿里云测试手机**, its authenticated Aliyun ADB connection, and an isolated real Gateway launched from the current source tree. An unauthenticated request was rejected with HTTP 401. The authenticated model list exposed GPT as configured with `structured-tools-phone-v1`.

A real synthetic-image diagnostic passed action-protocol validation and button grounding without executing phone input. The native task then asked GPT to open Android Settings → Display and show **字体大小 / 显示大小**, without changing settings. GPT made two phone-planning requests and proposed one swipe followed by one tap. Both had completed dispatch receipts; there were no unknown dispatches. The operation took 26,168 ms and stopped with `condition_satisfied`, `verified: true`, `verificationLevel: ui`.

After closing the Gateway phone session, a separate native observation confirmed both exact option labels inside the screen bounds in `com.android.settings`. The final screenshot was also inspected and showed the Display page. Sampled brightness, brightness mode, screen timeout and font-scale values were unchanged. The isolated Gateway was stopped, its temporary database/configuration removed, and the original device lease released. User model selections and phone registration were preserved. OAuth refresh continued to use the original credential store.

## Test boundaries and corrections

The first direct request timed out because Node did not inherit macOS's system HTTP proxy. Subsequent calls used the existing local proxy through `HTTP_PROXY` / `HTTPS_PROXY`, with loopback excluded. No persistent proxy configuration was changed. One early Gateway diagnostic also failed; the final run passed the real diagnostic and native task without a model fallback.

An earlier native trial used “亮度 / 深色主题” as completion text. Those words also occur in the main Settings list summary, so it passed the runtime text condition after a swipe but failed the independent exact-label check. That trial was rejected. The accepted run used page-specific options and passed both checks. This illustrates why task completion text must distinguish the destination page from navigation summaries; it is not evidence that arbitrary text conditions establish page identity.

Only this GPT model, registered Aliyun phone and read-only Settings navigation were tested. This does not certify every visual model, mobile application, text input, login or consequential operation. Screenshots were limited to the synthetic fixture and system Settings; credentials, cloud endpoints and screenshot bytes are absent from the retained JSON evidence.

## Reproduction

Sign in with ChatGPT under xopc's OpenAI provider. Use an idle, uniquely named registered Aliyun test phone. The harness acquires a temporary lease in the original database and limits its isolated Gateway to `com.android.settings`; it refuses an occupied phone. With the normal outbound proxy environment configured if needed:

```bash
node --import tsx/esm scripts/verify-chatgpt-phone.mts \
  --device-name '阿里云测试手机' \
  --model openai/gpt-6.1-sol \
  --output /tmp/xopc-chatgpt-phone-verification
```

The harness also supports the dedicated `XOPC_Android_Test_API_35` local AVD through `--serial`. It does not start or shut down the device itself. The current run's isolated emulator was stopped before switching to the requested Aliyun phone. Phone screenshots and transient verification artifacts live under the output directory; the persistent metadata-only result is [retained here](evidence/phone-use-gpt-oauth-live-2026-10-29.json).
