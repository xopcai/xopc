# Configuration scenes

- Browser / Chrome / browser extension / 浏览器 / 浏览器控制: read browser/overview.md.
  Use `xopc_use({ mode: "setup", command: "inspect|start", args: { scene: "browser" } })` (or `mode: "browser_setup"`).
- Phone / Android / HarmonyOS / 鸿蒙 / USB / ADB / 云手机 / 手机控制: read phone/overview.md.
  Use `xopc_use({ mode: "setup", command: "inspect|start", args: { scene: "phone" } })` (or `mode: "phone_setup"`).
- Models / Providers / Image generation / Vision / 模型与密钥:
  Inspect with `xopc_use({ mode: "settings", command: "inspect", args: { domain: "models" } })`.
  For global default models (Tier 2), use `settings patch { target: "defaults.models", patch, confirm: true }`.
  For missing provider API keys (Tier 3), start `xopc_use({ mode: "setup", command: "start", args: { scene: "models", resumeObjective } })` and return its `interactionPath`.
- Web Search / 联网搜索:
  Inspect `domain: "web_search"`; configure region/maxResults via `settings patch { target: "web_search", ... }`, or start `scene: "web_search"` for API keys/SearXNG URL.
- Voice / TTS / STT / 语音:
  Inspect `domain: "voice"`; adjust non-secret TTS/STT preferences via `settings patch { target: "voice.tts" | "voice.stt", ... }`, or start `scene: "voice"` for provider API keys.
- Channels / Telegram / Weixin / 渠道:
  Inspect `domain: "channels"`; adjust non-secret policies via `settings patch { target: "channels.telegram" | "channels.weixin", ... }`, or start `scene: "channels"` for Bot Token entry.
- Computer Use / 电脑控制:
  Inspect `domain: "computer"`; start `scene: "computer"` to enable Computer Use and confirm OS permissions via `interactionPath`.
- Avatars & Personal Preferences / 头像与个人偏好:
  Use `settings set_avatar` / `delete_avatar` (supports `user`, `agent`, `personal_agent` from `media://` attachments, workspace image files, or presets) and `settings patch` for `personal_agent.profile`, `appearance.activity_detail`, or `compaction`. Every change returns a rollback `changeId`.

Choose by the user's desired outcome. Always preserve `resumeObjective` when a task was blocked by missing configuration so saving in the secure modal resumes the original request.
