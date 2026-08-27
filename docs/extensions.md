# Extensions

Extensions add xopc capabilities such as messaging channels, tools, providers, background services, or Gateway pages. Install only extensions you trust, because they run as part of your local xopc environment.

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
