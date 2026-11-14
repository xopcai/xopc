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

For a delayed UI transition, pass an expectation when the action supports it, or use \`wait\` for a known result before acting on the next screen. A navigation or click can already return the new page observation. Use that observation directly when it answers the task; re-observe if it is missing, stale, or a transition is still in progress.

A visible semantic node’s name and value are evidence of what the page displays. A textbox can display account data; read the returned label and value as shown. When the requested value and its context are visible on the expected page, report them and finish. Keep any necessary verification in this browser session, using an observation or screenshot. If the information is missing, report what could not be verified.

The tool does not accept CSS, XPath, JavaScript, cookie, storage, or network-inspection commands. Browser actions execute directly under the configured allow/deny policy. Sensitive fields expose only their semantic identity and values are redacted.

`;
