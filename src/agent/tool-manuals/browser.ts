export const browserUseManual = `# Browser Tool Manual

## browser_use

Use one typed action per call. Start with \`observe\` or \`navigate\`. Every observation returns a \`sessionId\`, \`revision\`, and semantic element refs. Element actions must use refs from the newest revision; never invent refs.

Available actions:

- \`observe\`: return URL, title, interactive semantic nodes, and changes. Set \`visual\` to \`always\` only when visual evidence is needed.
- \`navigate\`: open an HTTP(S) URL and optionally verify an expectation.
- \`click\`, \`fill\`, \`select\`: act on a semantic ref with its observation revision.
- \`press\`, \`scroll\`: act on an optional ref or the active page.
- \`wait\`: wait for page idle, text, or a ref visibility state.
- \`upload\`: attach workspace files to a file input.
- \`tabs\`: list, create, activate, or close task-owned tabs.
- \`sequence\`: run a short list of same-document ref actions.
- \`close\`: close the task-owned browser session.

The tool does not accept CSS, XPath, JavaScript, cookie, storage, or network-inspection commands. Re-observe after navigation or a stale-observation response. Browser actions execute directly under the configured allow/deny policy. Sensitive fields expose only their semantic identity and values are redacted.

## browser_automation

Reusable browser automations are strict JSON. They use semantic \`role\` plus \`name\` or \`nameIncludes\` targets and an exact \`allowedDomains\` list. Input templates use \`\${input.name}\`. Save a draft, validate it, then run/test that exact saved revision when the user requests execution or testing. Never repeat a write merely to verify a recording. Only successful runs with explicit successCriteria mark a revision verified; never store passwords, one-time codes, recovery codes, or payment details.
`;
