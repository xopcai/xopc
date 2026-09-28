# Android implementation plan

1. Update shared task/project work screen with local search, section-aware filters, counts, contextual intro and card metadata.
2. Update automation schedules with enabled/paused filtering and search while keeping metrics and actions intact.
3. Reorder user message references below text and render image composer attachments as thumbnail-only cards.
4. Add focused regression tests, then run Expo tests/typecheck/lint and Android Gradle compilation.

All changes live in `apps/mobile-expo` shared React Native files; Android has no separate UI fork.
