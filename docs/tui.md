# Terminal interface

The terminal interface is a full-screen local Chat client. Run it when you want interactive xopc without opening the desktop or browser console.

## Start

```bash
xopc
```

This is the same as:

```bash
xopc tui
```

It uses the current xopc profile, default Agent, model configuration, and local Session store.

## Resume work

```bash
xopc resume
xopc resume <session-key>
```

Use `xopc session list` if you do not know the key.

## Connect to a Gateway

Use Gateway mode when the Sessions and Agents live on another running xopc instance:

```bash
xopc tui --gateway
xopc tui --url <gateway-url>
```

Provide the Gateway token through the supported prompt or option. Do not include it in shared shell history.

## TUI or interactive CLI?

| Mode | Best for |
| --- | --- |
| `xopc` / `xopc tui` | Full-screen conversation with live progress |
| `xopc agent -i` | Simple line-oriented interactive use |
| `xopc agent -m "…"` | One request from a script or shell |

## Troubleshooting

- TUI exits immediately: run `xopc doctor` and `xopc models status`.
- Text display is broken: use a UTF-8 terminal and a font with the required characters.
- Wrong Agent or Sessions: check `xopc profile list`, `xopc config path`, and the Gateway URL.
- Remote progress disconnects: verify the tunnel/network and run `xopc gateway health` on the host.
