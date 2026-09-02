# Documentation information architecture

## Why this reorganization exists

The public documentation had grown by adding implementation notes alongside user instructions. That produced several problems:

- setup tasks were split across overlapping pages;
- navigation reflected code modules instead of user goals;
- API contracts, schemas, RFCs, test instructions, and release runbooks appeared in the user site;
- English and Chinese navigation differed;
- very long reference pages made the first successful setup harder to find.

The public site now has one purpose: help a user install, configure, use, and maintain xopc. A short technical explanation is appropriate only when it helps the user make a decision or understand a visible behavior.

## Public information architecture

| Section | User question | Typical content |
| --- | --- | --- |
| Start | How do I get a working assistant? | installation, first model, first message, diagnostics |
| Daily use | How do I complete work? | sessions, agents, tasks, workflows, automations, media |
| Channels | How do I use xopc from another app? | Telegram, Weixin, Feishu, web console |
| Configure and extend | How do I change capabilities? | models, tools, skills, MCP, extensions, connectors |
| Access and maintenance | How do I operate it safely? | gateway, remote access, heartbeat, updates |
| Reference | What is the exact command or field? | CLI, configuration keys, data locations, templates |

English and Simplified Chinese use the same section order and page coverage.

## Placement rules

### Public user documentation

Keep a page public when it directly answers at least one of these questions:

1. What does this feature do for me?
2. What must I prepare?
3. What exact steps should I follow?
4. How can I verify that it worked?
5. What are the common failure modes and safety implications?

Use this page shape where practical:

1. one-sentence outcome;
2. prerequisites;
3. the shortest successful path;
4. verification;
5. optional configuration;
6. troubleshooting and next steps.

### Internal design documentation

Store the following under `docs/design/`:

- product requirements and proposals;
- implementation designs and protocol contracts;
- database, event, API, and runtime architecture;
- migration and release runbooks for maintainers;
- test framework internals;
- documentation planning and audits.

Store durable decisions under `docs/adr/`. Both directories are excluded from the public VitePress build through `srcExclude`.

## Migration map

| Previous public page | New location or treatment |
| --- | --- |
| `architecture.md` | `design/technical/architecture.md` |
| `memory-architecture.md` | `design/technical/memory-architecture.md` |
| `realtime.md` | `design/technical/realtime.md` |
| `agent-capabilities.md` | `design/technical/agent-capabilities.md` |
| `agent-configuration.md` | `design/technical/agent-configuration.md`; public Agent guidance stays in `routing-system.md` |
| `concepts/system-prompt.md` | `design/technical/concepts/system-prompt.md` |
| `skills-testing.md` | `design/technical/skills-testing.md` |
| `mobile-build-release.md` | `design/release/mobile-build-release.md` |
| `documentation-quality.md` | `design/process/documentation-quality-legacy.md` |
| Agent configuration internals | `design/technical/agent-configuration.md`; the public configuration page remains task-oriented |
| Previous tool schema reference | `design/technical/tools-reference-legacy.md`; the public page now focuses on selection, permission, and diagnosis |
| Previous Skill authoring/test reference | `design/technical/skills-reference-legacy.md`; the public page now focuses on install, trust, and use |
| Previous MCP API reference | `design/technical/mcp-reference-legacy.md`; the public page now covers connection and Agent access |
| Previous extension SDK reference | `design/technical/extensions-reference-legacy.md`; the public page now covers install and operation |
| Previous Gateway API page | `design/technical/gateway-api-legacy.md`; the public page now covers running and accessing the Gateway |
| Previous model catalog dump | `design/technical/models-reference-legacy.md`; the public page points to the live catalog |
| Previous progress event design | `design/technical/progress-feedback-legacy.md`; the public page explains visible states |
| Previous structured context schema | `design/technical/user-understanding-legacy.md`; the public page explains review and privacy |
| Previous image API reference | `design/technical/image-multimodal-legacy.md`; the public page explains setup and safe use |
| Previous desktop pet manifest | `design/technical/desktop-pets-authoring-legacy.md`; the public page explains selection and guided creation |
| Previous tunnel implementation notes | `design/technical/tunnel-security-implementation-legacy.md`; the public page keeps only risk and operating guidance |

Existing user URLs are retained when the topic is useful but their content is rewritten around user outcomes. Developer-only pages are removed from public navigation and build output.

## Rewrite coverage

The first implementation pass covers both English and Simplified Chinese across these modules:

- homepage, installation, first model, and troubleshooting;
- Chat, Sessions, Agents, Projects, Tasks, Notes, Workflows, and Automations;
- Telegram, Weixin, Feishu/Lark, and web console channels;
- voice, images, progress, personalization, and desktop pet use;
- models, tools, Skills, MCP, extensions, and connectors;
- Gateway, mobile, remote access, Heartbeat, updates, and release channels;
- CLI, configuration, data locations, tool runtimes, and Agent profile templates.

Already task-oriented guides such as Docker installation and browser automation remain public; they are linked from the new structure and must follow the same maintenance standard.

## Delivery phases

1. Inventory public pages, navigation, duplicates, and internal plans.
2. Separate internal design/ADR material from published content.
3. Rebuild English and Chinese navigation around user goals.
4. Rewrite the first-success path, then daily use, integrations, operation, and reference.
5. Add non-rendering screenshot placeholders and a capture plan.
6. Fail builds on broken public links and validate examples and CLI coverage.

## Definition of done

- A new user can reach a successful first reply without reading an implementation page.
- Every setup guide states prerequisites, steps, verification, and common failures.
- Public navigation has matching English and Chinese topic coverage.
- No RFC, API contract, SDK guide, schema design, test framework, or maintainer release runbook is published in the user site.
- Public links and JSON examples pass automated checks.
- Missing screenshots do not produce broken images or block the written workflow.

## Writing standard

- Start with the result, not the implementation.
- Prefer UI paths and copyable commands over source-file names.
- Introduce one concept only when the user needs it to complete the task.
- Put optional detail after the shortest successful path.
- Explain defaults before listing every possible value.
- Never place secrets in examples; use placeholders and say where the real value is stored.
- Include a verification step for every setup guide.
- Use consistent product terms: **xopc**, **Agent**, **Session**, **Project**, **Task**, **Workflow**, **Automation**, and **Gateway**.
- Keep English and Chinese pages structurally equivalent; translate for clarity rather than word-for-word symmetry.

## Maintenance checks

Before merging documentation changes:

```bash
pnpm run docs:check
pnpm run docs:build
```

The VitePress build must fail on broken public links. Design and ADR files remain reviewable in Git but are not published in the user site.
