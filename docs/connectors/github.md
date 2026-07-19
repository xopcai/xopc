# GitHub connector

The GitHub connector follows the same Composio integration path used by OpenHuman:

- Composio hosts the GitHub OAuth flow and refreshes provider credentials;
- xopc stores connection ownership and installation policy locally;
- agents discover exact GitHub action contracts through Composio sessions;
- xopc applies read, write, and admin scope checks before execution;
- write and admin actions use the connector confirmation policy and execution audit log.

xopc does not ship a separate GitHub App, Device Flow implementation, token vault, or remote GitHub MCP transport.

## Setup

1. Create a Composio project and copy its API key.
2. Install the **Composio API Key** connector and enter that key.
3. Install the **GitHub** connector (`composio-github`). Its default scope is `read`.
4. Select **Connect account** and complete GitHub authorization on the Composio-hosted page.
5. Return to xopc and verify that the GitHub connection is active.
6. Raise the connector scope to `write` or `admin` only when those actions are required.

No `XOPC_BUILD_GITHUB_APP_CLIENT_ID`, `XOPC_BUILD_GITHUB_APP_SLUG`, GitHub client secret, or GitHub App installation is required.

If an earlier development build already installed the retired `github` MCP connector, remove that managed instance before installing `composio-github`; the two runtimes must not remain enabled together.

## Action policy

The GitHub connector uses the curated GitHub action catalog maintained alongside the connector implementation. Actions are classified as:

- `read`: repository, issue, pull request, branch, commit, user, and search operations;
- `write`: creating or updating repositories, files, commits, issues, comments, pull requests, reviews, and gists;
- `admin`: deleting repositories, refs, or files; changing collaborators; and cancelling workflow runs.

GitHub actions not present in this catalog are rejected even when the connector has `admin` scope. This matches OpenHuman's static-catalog behavior and prevents a newly published or ambiguous Composio action from bypassing local policy.
