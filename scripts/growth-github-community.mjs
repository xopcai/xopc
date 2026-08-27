#!/usr/bin/env node

const OWNER = 'xopcai';
const REPO = 'xopc';
const API = 'https://api.github.com';
const GRAPHQL = 'https://api.github.com/graphql';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const issuesOnly = args.has('--issues-only');
const discussionsOnly = args.has('--discussions-only');

const discussionDrafts = [
  {
    categoryCandidates: ['Show and tell', 'Show and Tell', 'General'],
    title: 'Show and tell: how are you using xopc?',
    body: `Thanks for trying xopc.

xopc is a local-first Task Loop OS for long-term AI work across terminal, web, desktop, mobile app, and messengers.

This thread is for sharing:

- what kind of goals or workflows you are trying to run with xopc
- which surface you use most: TUI, CLI, Web, Desktop, mobile app, Telegram, WeChat, or Feishu/Lark
- which model setup you use: cloud, local, or hybrid
- what felt confusing during install or first run

Useful links:

- Website: https://xopc.ai
- GitHub: https://github.com/xopcai/xopc
- First 5 Minutes: https://xopcai.github.io/xopc/first-5-minutes
- Mobile app: https://github.com/xopcai/xopc/tree/main/apps/mobile-expo

If xopc is useful or the direction feels worth supporting, a GitHub star helps more developers find it.`,
  },
  {
    categoryCandidates: ['Ideas', 'General'],
    title: 'Roadmap: local-first task loops across terminal, web, desktop, mobile app, and messengers',
    body: `This is the launch-week roadmap discussion for xopc.

The product direction:

> xopc is a local-first Task Loop OS: one AI assistant that keeps durable Tasks moving across terminal, web, desktop, mobile app, and messengers.

Current focus:

- make first-run setup simpler with \`xopc onboard --quick\`
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
- Mobile app: https://github.com/xopcai/xopc/tree/main/apps/mobile-expo`,
  },
  {
    categoryCandidates: ['Q&A', 'Q and A', 'General'],
    title: 'Q&A: installation, models, gateway, channels, and mobile app',
    body: `Use this thread for setup questions.

Quick start:

\`\`\`bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc tui --local
\`\`\`

Common topics:

- Node.js / package manager setup
- provider API keys and BYOK model configuration
- Ollama / LM Studio / vLLM local model setup
- local gateway and Web console
- remote access through Tailscale, FRP, SSH tunnel, or reverse proxy
- Telegram / WeChat / Feishu/Lark channels
- mobile app pairing

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
- \`xopc --version\`
- provider/model you selected
- the exact error text, with secrets removed`,
  },
];

const issueDrafts = [
  {
    title: 'docs: add screenshots to the First 5 Minutes walkthrough',
    labels: ['good first issue', 'help wanted', 'type:docs', 'area:cli-tui', 'priority:P3'],
    body: `## Context

The launch-week docs include a First 5 Minutes walkthrough:

https://xopcai.github.io/xopc/first-5-minutes

It is easier to trust a new developer tool when the first-run path includes real screenshots.

## Scope

Add 2-4 screenshots or short terminal captures that show:

- install command
- \`xopc onboard --quick\`
- \`xopc tui --local\`
- a first prompt that starts a long-running project loop

## Acceptance criteria

- Screenshots are readable on desktop and mobile docs pages.
- Secrets, local usernames, and private paths are not visible.
- English and Chinese docs either both get screenshots or share language-neutral images.
- The page still builds with \`pnpm run docs:build\`.

## Useful links

- Website: https://xopc.ai
- First 5 Minutes: https://xopcai.github.io/xopc/first-5-minutes
- Docs source: \`docs/first-5-minutes.md\``,
  },
  {
    title: 'docs: add an Ollama local model quickstart',
    labels: ['good first issue', 'help wanted', 'type:docs', 'area:providers', 'priority:P3'],
    body: `## Context

xopc supports local and hybrid model setups. A focused Ollama quickstart would help users who want to try xopc without starting with a hosted model provider.

## Scope

Add a short docs section or page that covers:

- installing/running Ollama at a high level
- pulling a small model suitable for a first test
- configuring xopc through \`xopc onboard --quick\` or config
- running \`xopc tui --local\`
- common troubleshooting notes

## Acceptance criteria

- The quickstart is linked from Getting Started or provider/model docs.
- It clearly states that model quality depends on the chosen local model.
- It does not require users to expose local services publicly.
- The docs build passes with \`pnpm run docs:build\`.

## Useful links

- Website: https://xopc.ai
- Getting started: https://xopcai.github.io/xopc/getting-started
- Main repo: https://github.com/xopcai/xopc`,
  },
  {
    title: 'docs: add a Telegram channel setup screenshot flow',
    labels: ['good first issue', 'help wanted', 'type:docs', 'area:channels', 'priority:P3'],
    body: `## Context

One of xopc's core promises is continuity across terminal, web, desktop, mobile app, and messengers. Telegram is a good first channel to document visually.

## Scope

Add a screenshot-backed setup flow for Telegram:

- creating or selecting a bot token
- adding the token to xopc config
- choosing a DM or group policy
- starting the gateway/channel runtime
- sending a first message

## Acceptance criteria

- Bot tokens and personal chat IDs are redacted.
- The doc explains the difference between local-only use and exposing gateway/channel access.
- The setup flow links to the existing channel configuration docs.
- The docs build passes with \`pnpm run docs:build\`.

## Useful links

- Website: https://xopc.ai
- Docs: https://xopcai.github.io/xopc/
- Main repo: https://github.com/xopcai/xopc`,
  },
  {
    title: 'docs: add troubleshooting FAQ for xopc onboard --quick',
    labels: ['good first issue', 'help wanted', 'type:docs', 'area:cli-tui', 'priority:P3'],
    body: `## Context

\`xopc onboard --quick\` is the launch-week low-friction setup path. The docs should answer the questions people hit during first run.

## Scope

Add a short FAQ covering:

- Node.js version issues
- missing provider API keys
- selecting cloud vs local models
- where config is stored
- how to retry onboarding
- how to start the TUI after quick setup

## Acceptance criteria

- FAQ is linked from Getting Started and First 5 Minutes.
- Answers are short and actionable.
- The doc avoids logging or displaying secrets.
- The docs build passes with \`pnpm run docs:build\`.

## Useful links

- First 5 Minutes: https://xopcai.github.io/xopc/first-5-minutes
- Getting started: https://xopcai.github.io/xopc/getting-started
- Main repo: https://github.com/xopcai/xopc`,
  },
  {
    title: 'demo: record a 30-second gateway console clip',
    labels: ['good first issue', 'help wanted', 'type:docs', 'area:gateway', 'priority:P3'],
    body: `## Context

The README and launch posts need short demos that explain xopc quickly. A 30-second gateway console clip can show that xopc is not only a CLI tool.

## Scope

Record a short clip showing:

- starting \`xopc gateway\`
- opening the local Web console
- sending a prompt
- briefly showing settings or logs
- ending on the GitHub URL

## Acceptance criteria

- Clip is 20-40 seconds.
- No secrets, private file paths, or private messages are visible.
- The final frame includes \`github.com/xopcai/xopc\`.
- The clip can be linked from README or docs without requiring a large binary in the repo.

## Useful links

- Website: https://xopc.ai
- Main repo: https://github.com/xopcai/xopc
- Docs: https://xopcai.github.io/xopc/`,
  },
  {
    title: 'demo: record a 30-second mobile app pairing clip',
    labels: ['good first issue', 'help wanted', 'type:docs', 'area:gateway', 'priority:P3'],
    body: `## Context

xopc has a mobile client in the main repository:

https://github.com/xopcai/xopc/tree/main/apps/mobile-expo

A short pairing clip would make the mobile story easier to understand in launch posts.

## Scope

Record a short clip showing:

- desktop gateway running
- the pairing QR or base URL/token flow
- the xopc mobile app connecting from a phone or simulator
- sending one message from mobile

## Acceptance criteria

- Clip is 20-40 seconds.
- Tokens, local network secrets, and personal messages are hidden.
- The final frame includes \`github.com/xopcai/xopc\` and the mobile app docs URL.
- The clip can be linked from README, docs, or launch posts.

## Useful links

- Mobile app docs: https://xopcai.github.io/xopc/mobile-app
- Main repo: https://github.com/xopcai/xopc
- Mobile app source: https://github.com/xopcai/xopc/tree/main/apps/mobile-expo`,
  },
];

function usage() {
  console.log(`Usage:
  pnpm run growth:github-community             # dry-run all planned Discussions and Issues
  pnpm run growth:github-community -- --apply  # create missing items with GITHUB_TOKEN
  pnpm run growth:github-community -- --issues-only
  pnpm run growth:github-community -- --discussions-only

Environment:
  GITHUB_TOKEN  Token with repo issues and discussions permissions.
`);
}

function selectedIssues() {
  return discussionsOnly ? [] : issueDrafts;
}

function selectedDiscussions() {
  return issuesOnly ? [] : discussionDrafts;
}

async function githubFetch(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required when using --apply');

  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.message ? `${res.status} ${data.message}` : `${res.status} ${res.statusText}`;
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${message}`);
  }
  return data;
}

async function graphql(query, variables = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required when using --apply');

  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors?.length) {
    const message = data.errors?.map((err) => err.message).join('; ') || `${res.status} ${res.statusText}`;
    throw new Error(`GraphQL request failed: ${message}`);
  }
  return data.data;
}

async function listExistingIssues() {
  const issues = await githubFetch(`/repos/${OWNER}/${REPO}/issues?state=all&per_page=100`);
  return new Set(issues.filter((issue) => !issue.pull_request).map((issue) => issue.title));
}

async function repoDiscussionData() {
  const data = await graphql(
    `query RepoDiscussionData($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
        discussionCategories(first: 25) {
          nodes { id name }
        }
        discussions(first: 100) {
          nodes { title }
        }
      }
    }`,
    { owner: OWNER, repo: REPO },
  );
  return data.repository;
}

function resolveCategory(categories, candidates) {
  for (const name of candidates) {
    const found = categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
    if (found) return found;
  }
  const available = categories.map((category) => category.name).join(', ');
  throw new Error(`No discussion category matched [${candidates.join(', ')}]. Available: ${available}`);
}

function printDryRun() {
  console.log(`# GitHub community dry-run for ${OWNER}/${REPO}`);
  console.log('');

  const discussions = selectedDiscussions();
  if (discussions.length) {
    console.log('## Discussions');
    for (const draft of discussions) {
      console.log(`- ${draft.title}`);
      console.log(`  category candidates: ${draft.categoryCandidates.join(', ')}`);
    }
    console.log('');
  }

  const issues = selectedIssues();
  if (issues.length) {
    console.log('## Issues');
    for (const draft of issues) {
      console.log(`- ${draft.title}`);
      console.log(`  labels: ${draft.labels.join(', ')}`);
    }
    console.log('');
  }

  console.log('No GitHub changes were made. Add --apply and set GITHUB_TOKEN to create missing items.');
}

async function createIssues() {
  const existing = await listExistingIssues();
  for (const draft of selectedIssues()) {
    if (existing.has(draft.title)) {
      console.log(`skip issue: ${draft.title}`);
      continue;
    }
    const issue = await githubFetch(`/repos/${OWNER}/${REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: draft.title,
        body: draft.body,
        labels: draft.labels,
      }),
    });
    console.log(`created issue #${issue.number}: ${issue.title}`);
  }
}

async function createDiscussions() {
  const repo = await repoDiscussionData();
  const existing = new Set(repo.discussions.nodes.map((discussion) => discussion.title));
  for (const draft of selectedDiscussions()) {
    if (existing.has(draft.title)) {
      console.log(`skip discussion: ${draft.title}`);
      continue;
    }
    const category = resolveCategory(repo.discussionCategories.nodes, draft.categoryCandidates);
    const data = await graphql(
      `mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: {
          repositoryId: $repositoryId,
          categoryId: $categoryId,
          title: $title,
          body: $body
        }) {
          discussion { title url }
        }
      }`,
      {
        repositoryId: repo.id,
        categoryId: category.id,
        title: draft.title,
        body: draft.body,
      },
    );
    console.log(`created discussion: ${data.createDiscussion.discussion.url}`);
  }
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    usage();
    return;
  }

  if (!apply) {
    printDryRun();
    return;
  }

  if (!discussionsOnly) await createIssues();
  if (!issuesOnly) await createDiscussions();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
