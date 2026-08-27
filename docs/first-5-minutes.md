# Terminal quick start

This is the shortest path from a new installation to a working terminal conversation.

## 1. Install xopc

On macOS, Linux, WSL2, or Termux:

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

If Node.js 22 or newer is already installed:

```bash
npm install -g @xopcai/xopc
```

On Windows PowerShell:

```powershell
iex (irm https://xopc.ai/install.ps1)
```

Confirm that the command is available:

```bash
xopc --version
```

## 2. Connect one model

Run the short setup wizard:

```bash
xopc onboard --quick
```

Choose one provider, enter its credential, and select a model. Gateway, channels, skills, and additional Agents can wait.

## 3. Start chatting

```bash
xopc
```

Send a small verification prompt:

```text
Reply with “xopc is ready” and tell me which model you are using.
```

Exit with the key shown in the TUI help. The Session is saved, so you can resume it later with `xopc resume`.

## 4. Try one useful task

Use a request with a clear result, for example:

```text
Help me plan this week. Ask only for information you need, propose a realistic plan, and finish with the three most important next actions.
```

The assistant can use enabled tools and your workspace when the task requires them. It should ask before actions that need missing access or credentials.

## If it does not work

```bash
xopc models status
xopc doctor
xopc logs tail
```

- If no provider is configured, follow [Configure a model](./how-to/configure-first-model.md).
- If the command is not found, open a new terminal and verify that the installer added xopc to `PATH`.
- If the model rejects the request, verify the key, model name, account balance, and network access.

Continue with [Chat and sessions](./session.md) or open the browser console with `xopc gateway`.
