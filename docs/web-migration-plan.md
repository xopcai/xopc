# Gateway Console (Web UI)

The **gateway console** is the React single-page app in the `web/` package (Vite, Tailwind CSS v4, hash-based routing). It is the browser UI served by the gateway alongside the HTTP API.

## How it connects

| Mechanism | Use |
|-----------|-----|
| REST | Settings, sessions, cron, logs, config, etc. |
| SSE | Agent streaming (`POST /api/agent` with `Accept: text/event-stream`) |
| EventSource | Broadcast channel events (`GET /api/events`, optional `?token=`) |

Authentication uses the gateway token (see `gateway` / `onboard` docs).

## Stack (summary)

- React 19, React Router 7 (`createHashRouter`), Zustand, SWR, Lucide, Radix UI where needed

## Related docs

- [UI design system](/design/ui-design-system) — tokens and layout for the console
- [Gateway](/gateway) — API and process management
- [Configuration](/configuration) — `gateway` section in `config.json`

For contributor-oriented details, see **Web UI** in the repository root [`AGENTS.md`](https://github.com/xopcai/xopcbot/blob/main/AGENTS.md).
