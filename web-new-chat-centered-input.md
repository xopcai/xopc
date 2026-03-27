# New Chat Centered Input Layout — Technical Spec

> Feature: When opening a new chat session (`/chat/new`), center the `ChatComposer` vertically on the page with a headline above it. Once the user sends a message, transition back to the standard bottom-fixed input layout.

---

## Visual States

| State | Description |
|-------|-------------|
| **New Chat (empty)** | Headline "你想探索什么？" centered, `ChatComposer` in single-line pill style, vertically centered in the viewport |
| **New Chat (multiline)** | User presses Shift+Enter; textarea expands inside the card; layout stays centered |
| **After Send** | `isNewChat` flips to `false`; layout transitions to standard bottom-fixed composer; message list appears |

---

## Condition: `isNewChat`

```ts
const isNewChat =
  !sessionKey &&
  chatMessages.length === 0 &&
  !sending &&
  !streaming;
```

- `!sessionKey` — route is `/chat/new`, no session has been created yet.
- `chatMessages.length === 0` — no messages in the list.
- `!sending && !streaming` — prevents layout flash during the instant the first message is in-flight.

---

## Files Changed

| File | Change |
|------|--------|
| `web/src/features/chat/chat-page.tsx` | Conditional layout branch on `isNewChat` |
| `web/src/features/chat/chat-composer.tsx` | New `centerMode?: boolean` prop; adjusted outer container styles |
| `web/src/i18n/messages.ts` | New i18n key `chat.newChatHeadline` |

---

## `chat-page.tsx` — Layout Branch

Replace the single unified layout with a conditional:

```tsx
// Derive isNewChat after useChatSession() destructure
const isNewChat =
  !sessionKey &&
  chatMessages.length === 0 &&
  !sending &&
  !streaming;

// Inside the return JSX, replace the inner <div> with:
{isNewChat ? (
  /* ── Centered new-chat layout ── */
  <div className="flex flex-1 flex-col items-center justify-center px-4 sm:px-8">
    <h1 className="mb-6 text-2xl font-semibold tracking-tight text-fg">
      {m.chat.newChatHeadline}
    </h1>
    <div className="w-full max-w-2xl">
      <ChatComposer
        centerMode
        disabled={showSessionLoading || sessionRoutePending}
        sending={sending}
        streaming={streaming}
        sessionModel={sessionModel}
        showModelSelector={true}          {/* force-show even without sessionKey */}
        onModelChange={onSessionModelChange}
        thinkingLevel={thinkingLevel}
        showThinkingSelector={modelSupportsThinking}
        onThinkingChange={setThinkingLevel}
        onSend={sendMessage}
        onAbort={abort}
      />
    </div>
  </div>
) : (
  /* ── Standard bottom-fixed layout ── */
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="mx-auto flex w-full min-h-0 max-w-app-main flex-1 flex-col px-4 sm:px-8">
      <div
        ref={scrollRef}
        className="chat-messages min-h-0 flex-1 overflow-y-auto py-4 [scrollbar-gutter:stable]"
        onScroll={onScroll}
      >
        {/* existing message list JSX unchanged */}
      </div>
      <div className="chat-input-container shrink-0 bg-surface-panel py-4">
        <ChatComposer
          disabled={showSessionLoading || sessionRoutePending}
          sending={sending}
          streaming={streaming}
          sessionModel={sessionModel}
          showModelSelector={Boolean(sessionKey && !sessionRoutePending)}
          onModelChange={onSessionModelChange}
          thinkingLevel={thinkingLevel}
          showThinkingSelector={modelSupportsThinking}
          onThinkingChange={setThinkingLevel}
          onSend={sendMessage}
          onAbort={abort}
        />
      </div>
    </div>
  </div>
)}
```

> **Note:** `scrollRef` is only attached in the standard layout branch, so `onScroll` / `loadMoreMessages` are never triggered in centered mode.

---

## `chat-composer.tsx` — `centerMode` Prop

### Prop addition

```tsx
export const ChatComposer = memo(function ChatComposer({
  // ... existing props ...
  centerMode = false,
}: {
  // ... existing types ...
  centerMode?: boolean;
}) {
```

### Outer container style

```tsx
<div
  className={cn(
    'relative w-full overflow-hidden ring-1 ring-inset ring-edge',
    centerMode
      ? 'rounded-2xl bg-surface-hover/60 shadow-none dark:bg-surface-hover/40'
      : 'rounded-xl bg-surface-panel shadow-surface dark:bg-surface-panel/60 dark:shadow-none',
    isDragging && 'ring-2 ring-accent ring-inset',
  )}
  // ... drag handlers unchanged ...
>
```

Style differences between modes:

| Property | `centerMode=true` | `centerMode=false` (default) |
|----------|-------------------|------------------------------|
| `border-radius` | `rounded-2xl` (larger) | `rounded-xl` |
| `background` | `bg-surface-hover/60` (light grey) | `bg-surface-panel` |
| `box-shadow` | none | `shadow-surface` |

### `showModelSelector` in centered mode

In centered mode, `chat-page.tsx` passes `showModelSelector={true}` explicitly, bypassing the `Boolean(sessionKey && !sessionRoutePending)` guard that would otherwise hide the model picker on `/chat/new`.

---

## `messages.ts` — i18n Key

```ts
// en
chat: {
  newChatHeadline: 'What do you want to explore?',
  // ...
}

// zh
chat: {
  newChatHeadline: '你想探索什么？',
  // ...
}
```

---

## State Flow

```
User navigates to /chat/new
        │
        ▼
isNewChat = true
  → Centered layout: headline + ChatComposer (max-w-2xl, rounded-2xl)
        │
        │  User types (single line)  →  pill style, compact
        │  User presses Shift+Enter  →  textarea expands, card grows
        │
        │  User presses Enter / clicks Send
        ▼
sending = true  →  isNewChat flips false immediately
  → Layout switches to standard bottom-fixed composer
  → Message list renders with the first user bubble (top-right)
  → AI response streams in below ("正在思考...")
        │
        ▼
sessionKey assigned, route updates to /chat/:sessionKey
Standard conversation continues
```

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| User refreshes on `/chat/new` | `sessionKey` is still null, `chatMessages` is empty → centered layout shown correctly |
| Session loads with existing messages (e.g. `/chat/:key`) | `sessionKey` is set → `isNewChat = false` → standard layout, no regression |
| Sending fails (network error) | `sending` resets to `false`, `chatMessages` stays empty → `isNewChat` returns `true`, centered layout restored |
| Voice recording on new chat | `centerMode` does not affect voice logic; `toggleVoiceRecording` works identically |
| Attachment drag-drop on new chat | Drag overlay renders correctly inside the centered `ChatComposer` card |

---

## Non-Goals

- No animation/transition between centered and bottom layout (can be added later with `framer-motion` or a CSS `transition` on the wrapper if desired).
- No suggested prompts / quick-action chips in this iteration.
- No changes to `ChatHeaderBar` — it remains visible in both states.

---

_Last updated: 2026-03-27_
