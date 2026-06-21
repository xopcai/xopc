# Growth Metrics

Run this at the start and end of each launch day:

```bash
pnpm run growth:snapshot
```

Use JSON output when you want to paste the snapshot into another tracker:

```bash
pnpm run growth:snapshot -- --json
```

The snapshot records:

- GitHub stars, forks, watchers, open issues, and latest push time.
- npm latest version and last-week downloads.
- Remaining stars needed to reach 100.

Copy the daily numbers into `docs/growth/outreach-tracker.csv` notes or your external launch spreadsheet.
