# Share a conversation

XOPC can turn the current conversation into a read-only snapshot that you can send to other people. The shared page preserves the conversation's Markdown formatting while keeping private runtime context out of the snapshot.

## Create a share

1. Open the conversation in the desktop app or web console.
2. Select **Share conversation** in the conversation header.
3. Expand **Review the content to publish** and check the snapshot.
4. Choose a delivery method:
   - **XOPC Hosted Share** publishes to `https://share.xopc.ai`.
   - **Local Gateway Share** serves the snapshot from your own Gateway.
5. Optionally include tool activity or individual attachments.
6. Choose an expiration period and a maximum number of views. You can also add a short description.
7. Select **Create share**, then copy or open the generated link.

Anyone who has the link can view the snapshot until it expires, reaches its view limit, or is revoked. Do not send the link to a wider audience than you intended.

## Choose a delivery method

| | XOPC Hosted Share | Local Gateway Share |
| --- | --- | --- |
| Public URL | `https://share.xopc.ai/s/...` | Your configured Gateway URL |
| Owner device must stay online | No | Yes |
| First-time setup | Authorize the isolated XOPC Hosted Share connection | None |
| Best for | Sharing outside your network | Local, LAN, or self-hosted sharing |

Hosted Share uses a separate `xopc-share` OAuth resource with `shares:read` and `shares:write` permissions. It does not reuse model-provider keys or tunnel credentials. The authorization also requests offline access so XOPC can refresh the Hosted Share connection without asking you to sign in for every publish.

A Local Gateway link is only as reachable as the Gateway that serves it:

- a loopback Gateway produces a link that only works on the same computer;
- a LAN-bound Gateway produces a link that works on the same network; and
- a public tunnel or `gateway.publicUrl` produces a public link.

The share dialog shows the detected reachability. See [Remote access](./remote-access.md) if you want to make a Local Gateway share available outside your network. XOPC never uploads a local share to Hosted Share implicitly.

## What is shared

By default, the snapshot contains only visible user and assistant text.

| Content | Shared? |
| --- | --- |
| Visible user and assistant messages | Yes |
| Markdown headings, lists, tables, quotes, links, and code blocks | Yes |
| Tool names and completed/failed states | Only when you enable **Include tool activities** |
| Session attachments | Only the files you select individually |
| System prompts and hidden reasoning | Never |
| Tool arguments, tool results, commands, and command output | Never |
| Context/audit rows, workspace paths, Session keys, and model metadata | Never |

The public viewer sanitizes rendered Markdown. Selecting an attachment publishes a reviewed copy; the public link does not expose XOPC's original media store. Attachment downloads use short-lived tickets tied to the current snapshot revision.

If the conversation changes while the share dialog is open, XOPC rejects the stale publish request. Review the latest snapshot and create the share again.

## Expiration and view limits

The conversation share dialog offers expiration periods of **1 hour**, **24 hours**, **7 days**, or **30 days**. You can allow unlimited views or limit the link to **1**, **10**, or **50** views.

Opening the shared conversation counts as a view. Link previews and social-card metadata requests do not consume the view limit. Once a link expires or reaches its limit, the conversation is no longer available.

## Update or revoke a share

Reopen **Share conversation** for the same Session to manage its active share:

- **Copy** or **Open shared page** uses the existing link.
- **Update to current conversation** replaces the snapshot with the latest visible conversation while keeping the same URL. Previously shared content is not preserved as a public revision.
- **Revoke share** makes the link unavailable immediately.
- **New share** creates a separate link with its own expiration and view limit.

Later messages are never added automatically. Updating a share creates a new snapshot revision and invalidates attachment tickets from the previous revision.

## Before sharing sensitive conversations

- Read the snapshot preview instead of relying only on the conversation title.
- Leave tool activity disabled unless its names and states are useful to the recipient.
- Select attachments one by one and inspect each file first.
- Use the shortest practical expiration and a finite view limit.
- Revoke the link when it is no longer needed.

A share link is a bearer link: XOPC does not ask recipients to sign in. The random token makes the URL difficult to guess, but anyone who receives or forwards it can view the snapshot while it remains active.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| **Create share** is disabled for Hosted Share | Complete the XOPC Hosted Share authorization shown in the dialog |
| The snapshot changed before publishing | Close and reopen the dialog, review the new preview, and create the share again |
| A Local Gateway link works only on your computer | Configure a public tunnel or `gateway.publicUrl`; see [Remote access](./remote-access.md) |
| A Local Gateway link stopped working | Confirm that the Gateway is running and the public URL or tunnel still points to it |
| A shared page says it is unavailable | The link may be expired, revoked, over its view limit, or invalid |
| A newly created link returns 404 | Update XOPC, restart the Gateway, and create or open the share again |
| An attachment is missing | Only attachments selected when the snapshot was created or updated are published |

For Session storage and lifecycle behavior, see [Chat and sessions](./session.md).
