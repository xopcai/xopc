# OpenClaw TweetClaw Setup

Use this checklist when the user wants the xopc planning loop to hand off to TweetClaw for real X/Twitter operations.

## Install

```bash
openclaw plugins install @xquik/tweetclaw
openclaw config set tools.alsoAllow '["explore", "tweetclaw"]'
openclaw plugins inspect tweetclaw --runtime
openclaw skills info tweetclaw
```

## Credentials

Keep secrets local. Store account-backed API keys or signing keys in environment variables or local OpenClaw config. Do not paste them into chats, tickets, logs, docs, or PRs.

API key pattern:

```bash
openclaw config set plugins.entries.tweetclaw.config.apiKey "$XQUIK_API_KEY"
```

MPP signing key pattern:

```bash
openclaw config set plugins.entries.tweetclaw.config.tempoSigningKey "$MPP_SIGNING_KEY"
```

## Smoke Check

1. Ask the agent to use `explore` for tweet search endpoints.
2. Run a read-only tweet search with a narrow query.
3. Confirm results include tweet URLs or IDs and source metadata.
4. Draft one reply, but do not post it.
5. Ask for explicit approval before any write action.

## Safe First Prompts

```text
Use TweetClaw in read-only mode. Search tweets about "<market pain>" from the last 7 days. Return the top 10 buyer-intent signals with URLs and suggested next actions.
```

```text
Use TweetClaw in read-only mode. Search replies under tweets from <account>. Find objections, repeated questions, and language we can use in a launch post.
```

```text
Draft 5 replies to the approved signals. Do not post. Mark each draft low, medium, or high risk.
```

## Write Approval Prompt

```text
I approve posting draft <number> as written from account <account>. Use TweetClaw to post the reply to <tweet URL>.
```

## Troubleshooting

- If the skill is visible but tools are unavailable, recheck `tools.alsoAllow`.
- If the plugin is installed but live calls return setup guidance, configure an API key or MPP signing key.
- If posting is requested, require explicit user approval in the same session.
- If the user asks for private access or credential extraction, refuse and offer a read-only public workflow.
