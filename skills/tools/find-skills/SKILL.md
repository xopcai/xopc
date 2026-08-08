---
name: find-skills
description: Find and evaluate installable agent skills across the XOPC Store, ClawHub, and skills.sh. Use when a user asks whether a skill exists, wants capability recommendations, or wants help choosing a high-value skill.
---

# Find Skills

Use `skills_marketplace_search` for discovery. It is an internal read-only Tool, so it works in Electron without an `xopc` executable or renderer bearer token. It searches XOPC Store and ClawHub directly; skills.sh results are obtained through ClawHub's federation with their original provenance preserved.

## Workflow

1. Turn the requested capability, stack, and constraints into two to four concise queries. Include useful ecosystem synonyms.
2. Call `skills_marketplace_search` for the best query. Broaden once only when results are weak.
3. Prefer an already-installed skill when it fits well. Do not favor a marketplace duplicate solely because it has more downloads.
4. Compare at most five plausible candidates using this priority:
   - direct task and environment fit;
   - trustworthy provenance and acceptable security posture;
   - specific, usable instructions and understandable scripts;
   - recent maintenance and coherent versioning;
   - downloads and stars as supporting evidence only;
   - low overlap, dependency cost, and privilege requirements.
5. Return three to five candidates at most. Include source, installed status, why it fits, evidence, caveats, and canonical link or full install reference. Label one **Recommended** only when there is a clear winner.

Treat `valueScore` as heuristic ordering, not proof of quality. Never collapse ClawHub or skills.sh entries by slug alone; retain `source`, stable `id`, `canonicalUrl`, and `install.reference`. Surface `security.scanners` warnings and failures as caveats; do not recommend a scanner-failing candidate. Disclose any source whose status is not `ok`.

## Installation boundary

Search does not install anything. If installation was not explicitly requested, ask first. When the user explicitly requests a Store or native ClawHub result, call `skill_install` with its `provider` and full `install.reference` as `name`; omit `target` for the default global install under `~/.xopc/skills`, and pass `target: workspace` only when the user explicitly requests current-agent workspace scope. Never shorten an owner-scoped ClawHub reference to its slug. Use `source` only for an explicit Git, archive, file URL, or local-path installation. A skills.sh page URL is not automatically an installable source, so use the product Skills UI when no repository or archive source is available. Never extract or print Gateway credentials, and never set `force` or overwrite an existing skill without explicit approval.

If no candidate clears the quality bar, say so and propose creating a focused skill instead of padding the recommendation.
