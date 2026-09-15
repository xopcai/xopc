# Composer core

Portable browser utilities shared by the Web UI and Chrome extension:

- `@xopcai/composer-core/pasted-text`: classify long text/code pastes as attachments.
- `@xopcai/composer-core/pcm-wav-recorder`: PCM capture, streaming encoding and WAV recording.

The package has no React, application store, API client or UI dependencies. Consumers bundle the recorder with Vite so its AudioWorklet is emitted as a local asset. Existing Web composer tests cover these utilities; extension tests cover their integration.
