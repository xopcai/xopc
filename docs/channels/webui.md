# Web UI channel

The Web UI is the gateway’s built-in browser chat (static files served together with the gateway).

## Start gateway

```bash
xopc gateway --port 18790
```

## Access

Open `http://localhost:18790` in your browser (or your configured bind address).

## Features

- ✅ Chat via the gateway (REST; agent replies stream with **SSE** on `/api/agent`)
- ✅ Session management (`#/sessions`, sidebar task list)
- ✅ Settings (models, gateway token, voice, etc.)
- ✅ Log viewer
- ✅ Automation management

## Sidebar: filter sessions by channel

The sidebar session list can show **Web** / **Telegram** / **Weixin** / **Feishu** sessions:

- **Web** — lists sessions whose keys are treated as web UI sessions (client-side filter after `GET /api/sessions`).
- **Other channels** — `GET /api/sessions?channel=<id>` (e.g. `telegram`, `weixin`, `feishu`), matching `SessionMetadata.sourceChannel`.
