# Recovering missing plugin permissions

A connected account does not prove that every business operation is authorized. CLI authorization checks may now return bounded `issues` alongside `authenticated`. Each issue has an id, title, scopes, instructions, and optional official help URL and recovery method. The host validates the output, rejects unknown fields and unsafe URLs, and only accepts recovery methods declared in the reviewed package.

Setup persists these issues per account. A successful identity check keeps authenticated tools available while inventory reports that additional authorization is needed. Plugin details show the missing scope and recovery actions. A new connection/permission check replaces the prior issues; notices disappear only after the provider check succeeds.

Feishu 1.0.5 checks the actual read-only calendar agenda operation, in addition to user identity. Its calendar recovery method explicitly adds `calendar:calendar.event:read` to the recommended login scopes, retaining the configured application and private encrypted account. It never displays raw CLI output or credentials in the permission notice.

Inspection of the owner's Feishu application confirmed that the **user-identity application permission was already enabled and published**. The earlier assumption that application permissions needed changing was incorrect. The remaining gap was in the user's granted login scopes: the recommended-only login did not request this review-required calendar scope. The details page therefore offers direct supplemental authorization, with application-permission management as guidance only when application access has not yet been enabled.

The supplemental scope still requires the account owner's explicit QR confirmation. Production calendar acceptance remains pending until that confirmation, automatic connection/permission recheck, and a successful real-model conversation calling the installed plugin's calendar tool. No source push is authorized.

Regression coverage includes authenticated-but-partial setup, retained tool availability, persisted scope notices, successful recovery clearing the notice, rejection of unsafe guidance URLs/undeclared methods, and the frontend's targeted recovery request. Private evidence is under `/tmp/xopc-feishu-permission-release`.

## Handoff

The owner stopped live acceptance and chose to verify the remaining flow personally. The pending QR attempt was cancelled using Skip for now. Real calendar success and disappearance of the production permission notice have **not** been accepted. Completed automated checks: 48 backend tests, 15 web tests, 13 catalog tests, core/web type checks, ESLint, and the production web build. Feishu 1.0.5 is published on Store and installed locally. Source changes are committed locally only, with no push.
