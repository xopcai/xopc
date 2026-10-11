# Extensions

Extensions add xopc capabilities such as messaging channels, tools, providers, background services, or Gateway pages. Install only extensions you trust, because they run as part of your local xopc environment.

## Portable Agent Plugins

The same Extensions page also manages [Agent Plugins 1.0](https://agent-plugins.org/specification): a `plugin.json` package containing immediate-child `skills/*/SKILL.md` files and optional `mcp.json`. These bundles are not imported as native JavaScript extensions. A native `xopc.extension.json` takes precedence; no format fallback is attempted.

```bash
xopc extensions inspect ./my-plugin
xopc extensions install ./my-plugin --yes
xopc extensions enable plugin:my-plugin
xopc mcp list
# For protected HTTP servers, use the server ID printed by list:
xopc mcp login <server-id>
xopc extensions verify plugin:my-plugin
xopc extensions update plugin:my-plugin
xopc extensions rollback plugin:my-plugin
xopc extensions disable plugin:my-plugin
xopc extensions remove plugin:my-plugin
```

Sources can be a Gateway-local directory, ZIP, direct HTTPS ZIP URL, or `store:<package>[@version]`. The Gateway UI does not upload a directory from your browser. HTTPS downloads must use a direct URL without redirects. Initial installation is **disabled** and requires capability review; non-interactive CLI installation requires `--yes`. Updates that add or change executable/network capabilities require another review. Inspection never starts a server or runs an install script.

Enable the package, then use `xopc mcp list` for native pi diagnostics. Protected HTTP services use `xopc mcp login <server-id>` on the Gateway host; the browser callback is handled by pi. The plugin detail page can save static API keys for HTTP headers or stdio environment variables. Web OAuth, pasted remote callbacks, automatic plugin connection recovery, and SSE transport are no longer supported. See [MCP](./cli/mcp.md).

Static secrets remain in the xopc credential store and are resolved when configuration is projected to pi. Native OAuth credentials are stored by pi under the xopc state directory's `pi/` folder, separate from plugin artifacts and `xopc.json`. Use native `oauth` fields for a pre-registered client. Old credentials are not migrated.

Package activation uses its installation receipt, not `extensions.disabled`. MCP identities use `plugin_<normalized-package>_<stable-hash>`; the native server ID is shown in the plugin details. Package updates and rollbacks atomically switch revisions and preserve `PLUGIN_DATA`; edits to installed artifacts block activation until repaired. Local stdio servers are trusted programs and follow pi's transport behavior. Package ZIP downloads retain host download validation.

Uninstall removes the package's installed revisions. Data and local credentials are retained unless `--remove-data` / `--remove-credentials` (or the corresponding UI checkboxes) are selected. The remove-credentials option clears host static keys; use `xopc mcp logout <server-id>` before uninstall to clear native OAuth credentials. Removing local credentials does not revoke provider-side grants. Previous revisions remain on disk until uninstall; the UI supports rollback to the preceding revision. Current connections are single-owner, not per-chat-user. Store SHA verification and package integrity checks do not establish publisher identity or constitute a signature verification system.

## Browse and inspect

```bash
xopc extensions list
xopc extensions search <keyword>
xopc extensions inspect <extension>
xopc extensions audit
```

Before installation, review the source, publisher, requested permissions, dependencies, configuration fields, and whether it can access credentials or local files.

## Install and activate

```bash
xopc extensions install <package-or-path>
xopc extensions inspect <extension>
xopc extensions health
```

You can also use the **Extensions** page in the Gateway console. Use that page or the `extensions.disabled` configuration list to activate or disable an installed extension. Restart the Gateway if the extension contributes runtime code and does not appear immediately.

## Configure

Use the extension's settings page when available. Otherwise follow the fields shown by `xopc extensions inspect <extension>` and the extension publisher's user guide.

Keep secrets in the supported credential or environment mechanism. Do not copy a publisher's example values without checking which permissions and external services they enable.

A native Extension that builds workflows or UI on top of external services declares `connectorDependencies` in `xopc.extension.json`. Install and authorize those Connectors separately from the Connector Store. Native Extensions cannot embed raw MCP configuration or own OAuth tokens. Portable Agent Plugins declare MCP components in `mcp.json`; pi manages their connections and OAuth, while xopc resolves static secret references.

## Update or disable

```bash
xopc extensions update <extension>
xopc extensions verify <extension>
```

Disable an extension from the Gateway Extensions page first when diagnosing startup, channel, provider, or tool conflicts. Disabling is reversible and preserves its installed files and configuration.

Before updating an important extension:

1. read its release notes;
2. back up xopc state;
3. check for new permissions or required fields;
4. update and restart;
5. run a small health test.

## Security checklist

- Prefer verified sources and pinned versions for unattended systems.
- Do not install packages from a chat message without reviewing them.
- Audit extensions that can run commands, access files, open network listeners, or read credentials.
- Give external-facing channel extensions restrictive access policies first.
- Remove unused credentials when an extension is no longer used.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Extension is installed but absent | It is enabled and the Gateway was restarted |
| Health check fails | Missing dependency, credential, platform support, or conflicting extension |
| Configuration is rejected | Use the current extension version's fields and run `xopc config validate` |
| Update breaks the feature | Review release notes, logs, and version compatibility; disable it while investigating |

Run `xopc extensions --help` for source, packaging, and advanced maintenance commands. Extension development details are intentionally kept in the repository's internal design documentation rather than the user site.
