# Heartbeat checks

Heartbeat lets xopc periodically ask an Agent to review a small checklist and report useful changes. Use it for lightweight awareness, not for exact-time jobs or critical monitoring.

## Heartbeat or Automation?

- Use **Heartbeat** for periodic “look around and report if needed” checks.
- Use an [Automation](./automations.md) when timing, retries, run history, and a defined action matter.

## Set up a heartbeat

1. Open **Settings → Heartbeat**.
2. Enable Heartbeat for the intended Agent.
3. Choose a conservative interval.
4. Add a short checklist with clear conditions for reporting.
5. Save and review the first result.

Example checklist:

```md
- Check whether any active Task is blocked or overdue.
- Report only new blockers or decisions I need to make.
- If nothing needs attention, do not send a message.
```

Keep the checklist small. Broad prompts consume more model usage and can produce repetitive notifications.

## Control notifications

Decide where results should appear and whether a quiet result should be suppressed. Test delivery in the target Session or channel before relying on it.

## Safe use

- Do not put secrets in the checklist.
- Avoid instructions that make external changes without confirmation.
- Use a low-cost model when appropriate.
- Pause Heartbeat when the Agent's data source or credential is unavailable.
- Use dedicated monitoring software for uptime, security, or emergency alerts.

## Troubleshooting

If checks do not run, confirm the Gateway service is continuously running, Heartbeat is enabled, the Agent has a valid model, and the interval has elapsed. Inspect **Settings → Logs** for the first Heartbeat error.
