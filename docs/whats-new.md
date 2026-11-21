# What's new in xopc

Updated November 21, 2026. This overview covers user-facing changes since late October, through the November 20 [core v0.0.487 tag](https://github.com/xopcai/xopc/releases/tag/v0.0.487) and [Android v0.0.135 release](https://github.com/xopcai/xopc/releases/tag/mobile-android-v0.0.135). iOS uses its own distribution channel and HarmonyOS is in internal testing. Check the build you have installed. [Mobile downloads](./mobile-app.md) · [Update xopc](./update.md) · [Compare the core tags](https://github.com/xopcai/xopc/compare/v0.0.419...v0.0.487)

## Ada and task delivery

- When the home page finds a repeated request it can suggest a draft Task. Open it to check the goal and scope before starting. Continuing goals let you review the next step as work progresses. [Personal AI follow-ups](./personal-agent-proactivity.md)
- Task cards bring together the outcome, artifacts, checks, and remaining work. Ada can accept eligible delegated work automatically once its checks pass. Ask explicitly to approve the result yourself if you want manual acceptance. You can also steer a supported running conversation or retry a failed Task after inspecting the recorded cause. [Delegate to Ada](./task-delegation.md) · [Review a Task](./task-review.md)
- Supported clients can offer suggestions for the next message after a reply. You choose what to send. [Chat and sessions](./session.md)

## Projects, Library, and editing

- Project previews surface Tasks and progress so you can resume work from the project. Start an automation setup chat from the project to keep it in that project, or from Personal for personal schedules. [Projects and Tasks](./projects-tasks-notes.md) · [Automations](./automations.md)
- **Library** collects files and generated results. On web and desktop, save a revised deliverable as another version, or open an editable workbook, discuss a cell range, and review proposed edits. Download a saved workbook version as Excel. [Work with files and projects](./workspace-guide.md)
- The web note editor adds a heading outline. If a save conflicts with a newer version, the editor retains the draft and offers recovery. [Notes](./projects-tasks-notes.md)

## Media and connected clients

- Ask for music or a video draft in chat with a configured generation service. Supported clients can play the result in the conversation, and the web player can keep music playing while you move between pages. A job may finish after the initiating reply. Open its result card to check progress or retrieve the completed media. [Images and generated media](./image-multimodal.md)
- The mobile sidebar brings together recent chats and work destinations. Supported builds let you set up models and custom MCP connections from the phone. Desktop builds with screenshot capture let you edit its shortcut in **Settings → Keyboard shortcuts**. [Mobile app](./mobile-app.md) · [Desktop app](./desktop-app.md)

## Connections and MCP

- Slack and Discord can route bot messages to an xopc Agent. Use **Settings → Channels** to connect a bot, approve direct-message pairing, and choose who can invoke it in shared channels. [Slack](./channels/slack.md) · [Discord](./channels/discord.md)
- **Device connections** shows connected clients and their reported capabilities. Separately, external MCP clients can use scoped Gateway grants to search workspace records or delegate to an xopc Agent. The Gateway offers local stdio and optional remote Streamable HTTP with OAuth. [Device connections](./desktop-app.md#check-connected-devices) · [MCP setup and Gateway access](./mcp.md)

## Changes after the November 20 release tags

The current source adds global Notes, draft recovery and conversation actions on Android, iOS, and HarmonyOS. New project chats use the configured project directory by default. Delegated implementation can still use a managed Git worktree. The Gateway MCP callback startup fix also landed after v0.0.487. Check the installed build for these changes. [Mobile app](./mobile-app.md) · [Project chat environments](./session.md#models-and-project-environments)

## Upgrading from October

Browser workflow recording, saved workflows and replay were removed on November 3. Browser control remains available. Computer Use remains a desktop preview on macOS and Windows x64. Android phones can also use the separate Phone Use preview, including LAN pairing on Android 11 or later. [Browser extension](./browser-extension.md) · [Computer Use](./computer-use.md) · [Phone Use](./phone-use.md)

Check the release notes, update the Gateway and clients you use, and verify a model call and any important connections afterward. [GitHub Releases](https://github.com/xopcai/xopc/releases) · [Upgrade and recovery](./update.md)
