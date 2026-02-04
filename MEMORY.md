# xopcbot Long-Term Memory

## Project Architecture
- **Tech Stack**: Node.js 22+, TypeScript, ESM
- **LLM Provider**: pi-ai library (unified interface for 20+ providers)
- **Logging**: pino with structured logging
- **Channels**: Telegram, WhatsApp (Baileys placeholder)

## Key Design Decisions

### Provider Configuration
All OpenAI-compatible APIs use the `openai` provider config with auto-detected API base:
- Model ID format: `provider/model` (e.g., `qwen/qwen-plus`)
- API base auto-detected from model ID prefix
- Custom providers supported via `providers.custom.<model-id>`

### Custom Provider Schema
```json
{
  "providers": {
    "custom": {
      "<model-id>": {
        "name": "Display Name",
        "api_base": "https://api.example.com/v1",
        "api_key": "your-key",
        "api_type": "openai" // or "anthropic"
      }
    }
  }
}
```

## Commands
```bash
cd /home/admin/clawd/xopcbot
npm run dev -- agent -m "Hello"     # Test agent
npm run dev -- configure          # Interactive config wizard
npm run dev -- onboard           # Initialize workspace
npm run build                   # Compile TypeScript
```

## Known Providers
| Prefix | API Base |
|--------|----------|
| deepseek | https://api.deepseek.com/v1 |
| qwen | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| kimi | https://api.moonshot.cn/v1 |
| minimax | https://api.minimax.chat/v1 |
| openrouter | https://openrouter.ai/api/v1 |
| groq | https://api.groq.com/openai/v1 |
| vllm | http://localhost:8000/v1 |

## User Context
- Telegram: @micjoyce (ID: 916534770)
