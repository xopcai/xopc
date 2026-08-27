# On-disk layout

The user-facing map, backup guidance, and privacy notes are in [Data and file locations](./workspace.md).

Quick reference:

| Area | Default |
| --- | --- |
| State directory | `~/.xopc/` |
| Configuration | `~/.xopc/xopc.json` |
| Local database | `~/.xopc/xopc.db` |
| Credentials | `~/.xopc/credentials/` |
| Agent profile | `~/.xopc/agents/<id>/profile/` |
| Agent workspace | `~/.xopc/workspace/<id>/` unless configured otherwise |
| Logs | `~/.xopc/logs/` |

Use `xopc profile list`, `xopc config path`, and `xopc config show` to confirm effective locations. Do not edit the database or credential stores manually.
