# Gateway failure isolation and diagnostics

Realtime socket errors, authentication/heartbeat failures, and endpoint disconnection cleanup failures are contained to the affected connection. The client can reconnect; a malformed or oversized WebSocket frame must not stop the Gateway. Endpoint invocation completion preserves the tool result even if audit storage or upload cleanup fails.

The task dispatch timer runs one dispatch pass at a time. Synchronous and asynchronous failures are logged once per consecutive failure period, and the next tick can retry. Browser setup subprocess launch errors are handled and logged.

## Logs to collect after an unexpected exit

With the default configuration, collect these files from `~/.xopc/logs/`, including their `.1` and `.2` rotated copies when present:

- `gateway-process.log`: process startup, uncaught exception stack/origin, memory usage at the exception, unhandled Promise rejections, and process exit code/uptime. Written synchronously without using SQLite or the asynchronous application logger.
- `gateway-supervisor.log`: Electron's Gateway child PID, exit code/signal, and a bounded stderr tail (up to 64K characters). The parent captures the final stderr after the child's pipes close, including output that arrives after the process exit event. This can capture native crashes and externally killed children that cannot run their own exit handlers.
- `app-YYYY-MM-DD.log` and `error-YYYY-MM-DD.log`: application context before the failure.

`XOPC_LOG_DIR` overrides the diagnostic directory. Otherwise, diagnostics go in `logs/` beside the Gateway config file. Electron passes the child diagnostic destination explicitly using `XOPC_GATEWAY_DIAGNOSTIC_PATH`.

Each diagnostic log rotates at 2 MiB and retains two older files (up to approximately 6 MiB per log). New files use owner-only permissions where supported. Diagnostics use the existing secret-redaction policy; leave `XOPC_LOG_REDACTION` enabled. A failure to write diagnostics, such as a full disk, is contained and does not throw into the service.

The fatal exception monitor records failures without changing Node's fatal-exception exit behavior. Continuing after an arbitrary uncaught exception could leave shared state inconsistent. Known operational failures are caught at their connection/task boundaries instead. The existing unhandled-rejection handler now records non-SQLite rejections rather than silently ignoring them.

These changes do not automatically restart Electron's Gateway or replay an interrupted tool call. They also cannot guarantee a record if both Electron and its Gateway are killed, power is lost, or storage is unavailable. Restarting or upgrading to a newly built application is necessary for the changes to take effect.
