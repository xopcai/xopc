# Documentation screenshot plan

Screenshots are optional support material, not a dependency for completing a guide. Add them only where the UI location is genuinely faster to understand visually.

## Capture rules

- Use the current release, light theme, and a window width of about 1440 px unless a mobile screen is required.
- Crop to the relevant product area while retaining enough navigation context.
- Hide API keys, tokens, user names, message contents, paths, and account identifiers.
- Use sample names such as `main`, `Research`, and `Weekly review`.
- Save PNG images at 2× density; use WebP only if text remains crisp.
- Keep English-neutral UI where possible so one image can support both languages.
- Add meaningful alt text in both language pages.

## Requested captures

| Priority | Capture | File path | Place after |
| --- | --- | --- | --- |
| P0 | Desktop first-run screen | `docs/public/screenshots/desktop-first-run.png` | Desktop app → “First run” |
| P0 | Model provider setup with secret field empty | `docs/public/screenshots/model-setup.png` | Configure a model → “Using the desktop or web console” |
| P0 | Chat screen after a successful first reply | `docs/public/screenshots/first-chat.png` | Getting started → verification |
| P1 | Agent list and edit entry | `docs/public/screenshots/agents.png` | Agents → “Create an Agent” |
| P1 | Channels overview with one healthy channel | `docs/public/screenshots/channels.png` | Channels → status explanation |
| P1 | Remote access overview with sensitive values hidden | `docs/public/screenshots/remote-access.png` | Remote access → method selection |
| P2 | Automation editor showing trigger and target | `docs/public/screenshots/automation-editor.png` | Automations → creation steps |
| P2 | Workflow editor with a small three-step workflow | `docs/public/screenshots/workflow-editor.png` | Workflows → creation steps |
| P2 | Logs page with one filtered request | `docs/public/screenshots/logs-filter.png` | Troubleshooting → logs |
| P2 | Mobile connection form | `docs/public/screenshots/mobile-connect.png` | Mobile app → connect |

Do not embed a path until its image exists; otherwise the published page displays a broken asset. The user guides contain complete text instructions in the meantime.
