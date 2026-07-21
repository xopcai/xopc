---
name: build-xopc-local-app
description: Build and iteratively improve a user-owned local XOPC app while preserving its stable extension identity, UI sandbox, and Phase 1 capability boundary.
metadata:
  xopc:
    emoji: "🧩"
    requires_tools:
      - read_file
      - write_file
      - exec_command
---

# Build a local XOPC app

Use this skill inside a Project created for a Local App. Treat `APP_BRIEF.md`, `.xopc/app.json`, and
`xopc.extension.json` as the app contract. Convert the user's latest request into a small observable UI
change, preserve working behaviour, and leave the draft previewable after every iteration.

## Required workflow

1. Read `APP_BRIEF.md`, `.xopc/app.json`, `.xopc/acceptance.json`, `xopc.extension.json`, and the
   current `ui/` implementation.
2. Restate the requested behaviour as observable acceptance checks. Add or update a declarative
   scenario in `.xopc/acceptance.json` for each critical journey changed by the request.
3. Edit the smallest coherent set of files. Phase 1 apps are UI-only; do not add backend routes,
   shell execution, network access, or undeclared permissions. Never edit the manifest `main` field
   or `.xopc/runtime/local-ui.js`; xopc owns that trusted gateway runtime entry.
4. Keep the extension `id`, page `path`, and UI `entrypoint` stable. Do not rename them during an
   iteration.
5. Run `node "$XOPC_LOCAL_APP_SKILL_DIR/scripts/validate-local-app.mjs" .` when that environment
   variable is available. Otherwise validate the same contract directly.
6. Report what changed, what was verified, and whether the draft is ready for the user to install.

## Interface constraints

- Use semantic HTML, keyboard-accessible controls, visible focus states, and `aria-live` for async
  feedback.
- Support light and dark color schemes without assuming access to the host DOM.
- Keep scripts and styles local. The preview CSP blocks network access and inline scripts.
- Use browser storage only for user-owned local preferences or app data.
- Ask before expanding permissions. A permission change must be visible in the install review.
- Mark scenario targets with stable `data-xopc-test-id` values. Never encode CSS selectors or
  executable JavaScript in acceptance scenarios.

For the exact Phase 1 file contract and completion checklist, read `references/app-contract.md`.
