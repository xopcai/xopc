# What's new

These are user-facing entry points as of October 10, 2026. See [GitHub Releases](https://github.com/xopcai/xopc/releases) for exact versions and artifacts, and [Update xopc](./update.md) for upgrade steps. Desktop, Gateway, mobile, and browser extension builds are distributed separately; updating the core package does not update every client.

## Personal Agent and task delivery

Recent versions add the Personal AI destination, profile and response preferences, delegated-task activity, and delivery of results and files into the personal conversation. Delegate work, keep discussing, then inspect the result and request changes.

- [Meet Ada](./personal-ai.md)
- [Delegate and receive results](./task-delegation.md)
- [Review and accept a Task](./task-review.md)

## Follow-ups and Task acceptance

Follow selected topics, inspect why an update arrived, delay or stop attention, and set quiet hours. The workbench supports acceptance-criterion review and retrying failed executions. A topic check is not a guaranteed delivery time; a finished execution is not an accepted Task.

- [Personal AI follow-ups](./personal-agent-proactivity.md)
- [Projects, Tasks, and Notes](./projects-tasks-notes.md)

## v0.0.369: browser recording and client experience

- Browser recording in the Chrome extension side panel: select a website, start, pause, finish saving, and run it again. Recorded values can become replay inputs. Use a compatible Gateway and recording-capable extension.
- Native mobile sources add personal Agent profile controls and chat display improvements; availability depends on each platform's distributed client version.
- Browser control removes the older step-by-step approval flow. Define the permitted scope and inspect the real website and inputs before replay.

[Recording and replay](./browser-automations.md) · [Mobile app](./mobile-app.md) · [Version diff](https://github.com/xopcai/xopc/compare/v0.0.368...v0.0.369).

## Models, voice, and images

Recent updates improve XOPC Cloud model setup, voice selection and call handling, and image generation and editing support. Choose models from the current catalog; capabilities depend on provider, credentials, and client version.

[Models](./models.md) · [Voice](./voice.md) · [Images and vision](./image-multimodal.md). [Computer Use](./computer-use.md) remains a macOS preview requiring a dedicated compatible GUI model and native permissions.

## Check after upgrading

1. Update the desktop or Gateway you use, and check phone and extension versions separately.
2. Verify model and service credentials with a small request.
3. Inspect browser automation inputs and targets before a test run.
4. Review existing task artifacts and waits before duplicating delegation or external writes.
