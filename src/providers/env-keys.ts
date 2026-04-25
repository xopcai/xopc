/**
 * Provider → environment variable resolution (no credentials module dependency).
 * Keys align with pi-ai KnownProvider + @mariozechner/pi-ai getEnvApiKey where applicable.
 */

export const PROVIDER_ENV_MAP: Record<string, string[]> = {
	openai: ['OPENAI_API_KEY'],
	anthropic: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
	deepseek: ['DEEPSEEK_API_KEY'],
	google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
	'google-vertex': ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'],
	groq: ['GROQ_API_KEY'],
	xai: ['XAI_API_KEY'],
	cerebras: ['CEREBRAS_API_KEY'],
	mistral: ['MISTRAL_API_KEY'],
	openrouter: ['OPENROUTER_API_KEY'],
	'azure-openai-responses': ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_BASE_URL'],
	'amazon-bedrock': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
	minimax: ['MINIMAX_API_KEY'],
	'minimax-cn': ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
	'kimi-coding': ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
	huggingface: ['HF_TOKEN', 'HUGGINGFACE_TOKEN'],
	opencode: ['OPENCODE_API_KEY'],
	'opencode-go': ['OPENCODE_API_KEY'],
	zai: ['ZAI_API_KEY'],
	'google-gemini-cli': ['GEMINI_CLI_TOKEN', 'GOOGLE_TOKEN'],
	'google-antigravity': ['ANTIGRAVITY_API_KEY'],
	'vercel-ai-gateway': ['AI_GATEWAY_API_KEY', 'VERCEL_AI_GATEWAY_API_KEY'],
	'github-copilot': ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_COPILOT_TOKEN'],
	/** DashScope HTTP APIs (image gen, STT, TTS) — not an LLM KnownProvider. */
	dashscope: ['DASHSCOPE_API_KEY'],
};

/**
 * Get API key from environment variables for a provider
 */
export function getApiKeyFromEnv(provider: string): string | undefined {
	const envVar = provider.toUpperCase().replace(/-/g, '_') + '_API_KEY';
	const envKey = process.env[envVar];
	if (envKey) return envKey;

	const keys = PROVIDER_ENV_MAP[provider] || [];
	for (const key of keys) {
		if (process.env[key]) return process.env[key];
	}

	return undefined;
}
