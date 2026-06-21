# GitHub Discussion Drafts

> Use these before broad launch posts. Goal: make the repository feel active, easy to ask in, and clearly aligned with long-running AI workflows.

## 1. Show And Tell

Category: `Show and tell`

Title:

```text
Show and tell: how are you using xopc?
```

Body:

```markdown
Thanks for trying xopc.

xopc is a local-first Goal Loop OS for long-term AI work across terminal, web, desktop, mobile app, and messengers.

This thread is for sharing:

- what kind of goals or workflows you are trying to run with xopc
- which surface you use most: TUI, CLI, Web, Desktop, mobile app, Telegram, WeChat, or Feishu/Lark
- which model setup you use: cloud, local, or hybrid
- what felt confusing during install or first run

Useful links:

- Website: https://xopc.ai
- GitHub: https://github.com/xopcai/xopc
- First 5 Minutes: https://xopcai.github.io/xopc/first-5-minutes
- Mobile app: https://github.com/xopcai/xopc-app

If xopc is useful or the direction feels worth supporting, a GitHub star helps more developers find it.
```

First maintainer reply:

```markdown
For this launch week, I am especially looking for feedback from:

- people using AI for long-running projects, not only one-off prompts
- people running local or hybrid model setups
- people who want the same assistant across terminal, web, phone, and messengers

I will turn repeated questions into docs or issues during the week.
```

## 2. Roadmap

Category: `Ideas` or `General`

Title:

```text
Roadmap: local-first goal loops across terminal, web, desktop, mobile app, and messengers
```

Body:

```markdown
This is the launch-week roadmap discussion for xopc.

The product direction:

> xopc is a local-first Goal Loop OS: one AI assistant that keeps long-term goals moving across terminal, web, desktop, mobile app, and messengers.

Current focus:

- make first-run setup simpler with `xopc onboard --quick`
- make the TUI and local gateway console easier to try in a few minutes
- improve docs for local models, remote gateway access, and mobile pairing
- collect real workflows from people who use AI over days or weeks
- keep the extension / skills / channel architecture open enough for community use

Questions for the community:

1. Which surface should be the best first experience: TUI, Web, Desktop, or mobile?
2. Which local model path should be documented first: Ollama, LM Studio, or vLLM?
3. Which channel matters most for continuity: Telegram, WeChat, Feishu/Lark, or mobile app?
4. What would make xopc worth starring or recommending to another developer?

Links:

- Website: https://xopc.ai
- GitHub: https://github.com/xopcai/xopc
- Docs: https://xopcai.github.io/xopc/
- Mobile app: https://github.com/xopcai/xopc-app
```

First maintainer reply:

```markdown
Launch-week bias:

- reduce install friction before adding broad new features
- prefer docs and demos that make the product easy to understand
- prioritize workflows that show continuity across surfaces

If you suggest a larger feature, please include the concrete workflow it unlocks.
```

## 3. Q&A

Category: `Q&A`

Title:

```text
Q&A: installation, models, gateway, channels, and mobile app
```

Body:

````markdown
Use this thread for setup questions.

Quick start:

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local
```

Common topics:

- Node.js / package manager setup
- provider API keys and BYOK model configuration
- Ollama / LM Studio / vLLM local model setup
- local gateway and Web console
- remote access through Tailscale, FRP, SSH tunnel, or reverse proxy
- Telegram / WeChat / Feishu/Lark channels
- xopc-app mobile pairing

Helpful links:

- Website: https://xopc.ai
- First 5 Minutes: https://xopcai.github.io/xopc/first-5-minutes
- Getting started: https://xopcai.github.io/xopc/getting-started
- Remote access: https://xopcai.github.io/xopc/remote-access
- Mobile app: https://xopcai.github.io/xopc/mobile-app
- GitHub: https://github.com/xopcai/xopc

When reporting a setup issue, please include:

- OS and shell
- install method
- `xopc --version`
- provider/model you selected
- the exact error text, with secrets removed
````

First maintainer reply:

```markdown
I will keep this thread open during launch week and convert repeated issues into docs or GitHub issues.

If your question turns into a reproducible bug, please open an issue with the template so we can track it.
```
