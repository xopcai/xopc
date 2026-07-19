# GitHub connector

The built-in GitHub connector uses one authorization architecture in every deployment:

- a product-owned public GitHub App;
- GitHub Device Flow, polled by the Gateway;
- expiring user access tokens with refresh-token rotation;
- the official remote MCP endpoint at `https://api.githubcopilot.com/mcp/`;
- an installed GitHub App to define repository access.

It does not accept personal access tokens, OAuth App credentials, client secrets, or a local GitHub MCP package.

## Release registration

Create the product GitHub App with Device Flow and expiring user tokens enabled. Configure the required repository and organization permissions in the App itself. Release builds must embed its public registration values:

```bash
XOPC_BUILD_GITHUB_APP_CLIENT_ID=... \
XOPC_BUILD_GITHUB_APP_SLUG=... \
pnpm run build
```

The build fails when either value is missing. The client id and slug are public metadata; no client secret or private key is shipped.

## Credential encryption

Electron generates a random 256-bit master key, protects it with Electron `safeStorage`, and passes it only to its Gateway subprocess. Linux `basic_text` storage is rejected.

A remote Gateway must provide its own 32-byte base64 master key through its secret manager:

```bash
export XOPC_CREDENTIALS_MASTER_KEY="$(openssl rand -base64 32)"
xopc gateway --bind lan
```

Persist the same secret across restarts. GitHub access and refresh tokens are encrypted at rest with AES-256-GCM. If the key is missing or invalid, GitHub connection fails closed; there is no plaintext fallback.

## User flow

The Connectors page displays the GitHub device code and opens GitHub's verification page. The Gateway polls automatically. After authorization it checks whether the product GitHub App is installed; if needed, the page links to the App installation screen. The connector becomes installable only after both authorization and App installation succeed.
