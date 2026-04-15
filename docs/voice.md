# Voice (STT/TTS)

xopc supports voice in multiple transports:

- **STT** (Speech-to-Text): voice attachments → text for the agent
- **TTS** (Text-to-Speech): assistant text → audio when policy allows

**Primary surfaces:** [Telegram](/channels) (voice notes) and **Web UI (webchat)** (voice attachments with STT). Other channels may receive TTS output if the outbound pipeline applies it.

---

## Overview

**Telegram (typical flow)**

1. Inbound audio is downloaded; STT runs (unless skipped by duration or policy).
2. For **groups** with mention gating, a **voice preflight** STT pass can run *before* mention checks so spoken “@bot” (or fuzzy variants like “at botname”) can satisfy mention rules.
3. The agent sees transcribed text (and may see file placeholders for non-voice media).
4. Outbound text may be wrapped with TTS (see triggers) and sent in a channel-appropriate format (e.g. Opus voice note vs MP3).

**Web UI (webchat)**

1. When STT is enabled, voice attachments are transcribed before the model sees the message.
2. TTS for replies follows the same trigger rules as other channels; the browser player uses **MP3**.

---

## Quick start

Minimal `~/.xopc/xopc.json` (keys may also come from env — see below):

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "your-dashscope-api-key"
    }
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "inbound",
    "openai": {
      "apiKey": "your-openai-api-key"
    }
  }
}
```

**Config note:** In JSON, `trigger` values are `off` | `always` | `inbound` | `tagged`. The legacy value **`auto` is normalized to `inbound`** when the config is loaded.

---

## STT configuration

### Alibaba Paraformer (often used for Chinese)

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "alibaba": {
      "apiKey": "your-dashscope-api-key",
      "model": "paraformer-v2"
    }
  }
}
```

See DashScope docs for current model IDs (`paraformer-v2`, etc.).

### OpenAI Whisper

```json
{
  "stt": {
    "enabled": true,
    "provider": "openai",
    "openai": {
      "apiKey": "your-openai-api-key",
      "model": "whisper-1"
    }
  }
}
```

### Fallback chain

If the primary provider errors, xopc tries other providers in `fallback.order`. Each run records a structured **attempt list** (provider, outcome, latency, reason) on the result type used internally — useful for logs and future diagnostics.

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba",
    "fallback": {
      "enabled": true,
      "order": ["alibaba", "openai"]
    }
  }
}
```

### Audio preflight (Telegram groups)

When the bot requires an @mention in a **supergroup/group**, **voice-only** messages are transcribed **before** mention filtering so the transcript can contain the bot name (or STT-friendly variants).

---

## TTS configuration

### Trigger modes

| Config value | Behavior |
|--------------|----------|
| `off` | No automatic TTS on outbound |
| `always` | TTS applied when outbound is text-only and policy passes |
| `inbound` | TTS when the user turn had inbound voice (metadata `transcribedVoice`) |
| `tagged` | TTS only when the assistant text contains `[[tts]]` (directive stripped before send) |

Legacy **`auto`** in config files is treated as **`inbound`**.

### OpenAI TTS

```json
{
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "inbound",
    "openai": {
      "apiKey": "your-openai-api-key",
      "model": "tts-1",
      "voice": "alloy"
    }
  }
}
```

**Voices:** `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`  
**Models:** `tts-1`, `tts-1-hd`

### Alibaba (DashScope TTS)

```json
{
  "tts": {
    "enabled": true,
    "provider": "alibaba",
    "trigger": "inbound",
    "alibaba": {
      "apiKey": "your-dashscope-api-key",
      "model": "qwen-tts",
      "voice": "Cherry"
    }
  }
}
```

### Microsoft Edge TTS (no API key)

```json
{
  "tts": {
    "enabled": true,
    "provider": "edge",
    "edge": {
      "enabled": true,
      "voice": "en-US-MichelleNeural",
      "lang": "en-US"
    }
  }
}
```

Set `"edge": { "enabled": false }` to take Edge out of rotation.

### Provider fallback (TTS)

```json
{
  "tts": {
    "enabled": true,
    "provider": "openai",
    "fallback": {
      "enabled": true,
      "order": ["openai", "alibaba", "edge"]
    }
  }
}
```

Failed attempts are logged with per-provider latency and reason; successful syntheses attach an **attempts** summary on the internal result type.

### Long text and `maxTextLength`

- **`maxTextLength`**: hard cap for text passed into providers (default in schema is **512** to stay within conservative provider limits; raise if your primary provider allows more).
- **`summarization`**: when enabled (default **on**), text longer than the threshold is shortened with a **small LLM** pass before TTS. Set the model in `tts.summarization.model` or with env **`XOPC_TTS_SUMMARIZE_MODEL`**.

```json
{
  "tts": {
    "summarization": {
      "enabled": true,
      "threshold": 512,
      "targetLength": 512,
      "model": "openai/gpt-4o-mini"
    }
  }
}
```

### Directives (`[[tts:...]]`)

When `modelOverrides` is enabled (default), the model may use directives such as `[[tts:text]]...[[/tts:text]]` and voice/model hints. See your installed xopc version’s docs or schema for the full directive list.

---

## Agent tool: `text_to_speech`

When **`tts.enabled`** is true, the agent may register the **`text_to_speech`** tool. It synthesizes audio and **publishes an outbound voice message** for the current session (in addition to normal auto-TTS on the outbound path).

Use for explicit read-aloud requests; avoid spamming voice on every reply. Normal replies still go through **`send_message`**; the tool description and system **Voice (TTS)** section explain the split.

---

## In-chat commands: `/tts`

Built-in commands include:

- `/tts` — show trigger, provider, voice, readiness
- `/tts on` | `/tts off` — enable/disable TTS
- `/tts always` | `/tts inbound` | `/tts tagged` | `/tts never` — set trigger
- `/tts provider …` | `/tts voice …`
- **`/tts status`** — last TTS attempt, latency, fallback/summarization flags, and rolling success stats (in-memory per process)

---

## Channel audio formats

Outbound encoding is chosen per channel (for example Telegram **Opus** voice notes, Weixin and webchat **MP3**). Other channel ids follow the same defaults as the built-in “generic” profile unless an extension documents otherwise.

---

## Limits

| Limit | Value |
|-------|-------|
| Telegram voice STT | **60 s** (longer → skipped / placeholder) |
| TTS text | **`maxTextLength`** (configurable; schema default **512**) + optional LLM summarization |
| Web STT attachment size | Very large uploads may be rejected with a placeholder message |

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DASHSCOPE_API_KEY` | Alibaba DashScope (STT/TTS) |
| `OPENAI_API_KEY` | OpenAI (STT/TTS/summarization) |
| `XOPC_TTS_SUMMARIZE_MODEL` | Optional model ref for TTS summarization when `tts.summarization.model` is unset |

---

## Workflow (Telegram, simplified)

```
User sends voice
       │
       ▼
┌──────────────────────┐
│ Download audio       │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐   (groups + require mention)
│ Optional: preflight  │ ──► transcript used for @ detection
│ STT for mention      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ STT → user text      │  (may reuse preflight transcript)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Agent turn           │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Outbound + optional  │  summarization → TTS chain → compress
│ TTS (triggers)       │  → channel format (Opus/MP3/…)
└──────────────────────┘
```

---

## Troubleshooting

### STT fails

1. API key and quota  
2. Duration under 60s (Telegram)  
3. Fallback `order` includes a configured provider  
4. Logs: `XOPC_LOG_LEVEL=debug`

### No voice reply

1. `tts.enabled` and trigger mode (`inbound` needs inbound voice; `tagged` needs `[[tts]]`)  
2. `maxTextLength` / summarization failures (check logs)  
3. No provider in the fallback chain configured (Edge can unblock keyless tests)

### Diagnose last TTS

Use **`/tts status`** or inspect logs for provider attempts and `TTS:StatusTracker` debug lines.

---

## API reference (conceptual)

### STT

```typescript
interface STTConfig {
  enabled: boolean;
  provider: 'alibaba' | 'openai';
  alibaba?: { apiKey?: string; model?: string };
  openai?: { apiKey?: string; model?: string };
  fallback?: { enabled: boolean; order: ('alibaba' | 'openai')[] };
}
```

Transcribe results may include **`attempts`**, **`fallbackFrom`**, **`attemptedProviders`** metadata for diagnostics.

### TTS

```typescript
interface TTSConfig {
  enabled: boolean;
  provider: 'openai' | 'alibaba' | 'edge';
  trigger: 'off' | 'always' | 'inbound' | 'tagged';
  maxTextLength?: number;
  timeoutMs?: number;
  fallback?: { enabled: boolean; order: ('openai' | 'alibaba' | 'edge')[] };
  summarization?: {
    enabled?: boolean;
    threshold?: number;
    targetLength?: number;
    model?: string;
  };
  modelOverrides?: { /* see schema */ };
  openai?: { apiKey?: string; model?: string; voice?: string };
  alibaba?: { apiKey?: string; model?: string; voice?: string };
  edge?: { enabled?: boolean; voice?: string; lang?: string; /* … */ };
}
```

Speak results may include **`attempts`**, **`fallbackFrom`**, **`wasSummarized`**, and similar fields for diagnostics.

For the full `stt` / `tts` field reference, see [Configuration](configuration.md). After editing JSON, run `xopc config show` or start the gateway to confirm the file loads.

---

## Best practices

1. Configure **STT fallback** for resilience.  
2. Set **`maxTextLength`** to match your primary TTS provider; enable **summarization** for long answers.  
3. Use **`/tts status`** after misconfiguration changes.  
4. Prefer **env vars** for API keys.  
5. In groups, rely on **voice preflight** + clear bot username for mention behavior.
