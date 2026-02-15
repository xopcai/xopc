/**
 * Model Registry
 * 
 * Model registration and management based on pi-mono architecture.
 * Loads built-in models from @mariozechner/pi-ai and custom models from config.json.
 * Supports auto-discovery of local Ollama models.
 * Supports AuthStorage and AuthProfiles for OAuth and API key authentication.
 */

import {
	getModels,
	getProviders,
	type Api,
	type Model,
	type KnownProvider,
	type OAuthCredentials,
} from '@mariozechner/pi-ai';
import { getApiKey as getConfigApiKey, getApiBase } from '../config/schema.js';
import type { Config } from '../config/schema.js';
import type { AuthStorage } from '../auth/storage.js';
import { listProfilesForProvider } from '../auth/profiles/profiles.js';
import { resolveApiKeyForProfile, profileHasAuth } from '../auth/profiles/oauth.js';

const OLLAMA_API_BASE = 'http://127.0.0.1:11434';
const OLLAMA_TAGS_URL = `${OLLAMA_API_BASE}/api/tags`;

interface OllamaModel {
	name: string;
	model: string;
	modified_at: string;
	size: number;
	digest: string;
	details?: {
		parameter_size?: string;
		quantization_level?: string;
		family?: string;
	};
}

interface OllamaTagsResponse {
	models: OllamaModel[];
}

async function discoverOllamaModels(): Promise<Model<Api>[]> {
	try {
		const response = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(5000) });
		if (!response.ok) return [];

		const data = (await response.json()) as OllamaTagsResponse;
		if (!data.models || data.models.length === 0) return [];

		return data.models.map((model: OllamaModel) => ({
			id: model.name,
			name: model.name,
			api: 'openai-completions' as Api,
			provider: 'ollama',
			baseUrl: `${OLLAMA_API_BASE}/v1`,
			reasoning: model.name.toLowerCase().includes('r1') || model.name.toLowerCase().includes('reasoning'),
			input: ['text'] as ('text' | 'image')[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 131072,
			maxTokens: 4096,
			params: { streaming: false },
			headers: process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : undefined,
		})) as Model<Api>[];
	} catch {
		return [];
	}
}

async function isOllamaRunning(): Promise<boolean> {
	try {
		const response = await fetch(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(2000) });
		return response.ok;
	} catch {
		return false;
	}
}

export interface ProviderOverride {
	baseUrl?: string;
	apiKey?: string;
	api?: 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';
	models?: string[];
}

/** Built-in model definitions for additional providers */
export const BUILTIN_PROVIDER_MODELS: Record<string, Model<Api>[]> = {
	// Qwen (DashScope)
	'qwen': [
		{ id: 'qwen-plus', name: 'Qwen Plus', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384 },
		{ id: 'qwen-max', name: 'Qwen Max', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384 },
		{ id: 'qwen-turbo', name: 'Qwen Turbo', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384 },
		{ id: 'qwen-long', name: 'Qwen Long', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1048576, maxTokens: 8192 },
		{ id: 'qwq-32b', name: 'QwQ 32B', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: true, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 },
		{ id: 'qwen3-235b', name: 'Qwen3 235B', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: true, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384 },
		{ id: 'qwen3-30b', name: 'Qwen3 30B', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: true, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384 },
		{ id: 'qwen3-8b', name: 'Qwen3 8B', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: true, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384 },
		{ id: 'qwen3-4b', name: 'Qwen3 4B', api: 'openai-completions', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', reasoning: true, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 16384 },
	] as Model<Api>[],
	// Kimi (Moonshot AI)
	'kimi': [
		{ id: 'kimi-k2.5', name: 'Kimi K2.5', api: 'openai-completions', provider: 'kimi', baseUrl: 'https://api.moonshot.cn/v1', reasoning: true, input: ['text', 'image'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2000000, maxTokens: 8192 },
		{ id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', api: 'openai-completions', provider: 'kimi', baseUrl: 'https://api.moonshot.cn/v1', reasoning: true, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 32768 },
		{ id: 'kimi-k1.5', name: 'Kimi K1.5', api: 'openai-completions', provider: 'kimi', baseUrl: 'https://api.moonshot.cn/v1', reasoning: true, input: ['text', 'image'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
		{ id: 'kimi-latest', name: 'Kimi Latest', api: 'openai-completions', provider: 'kimi', baseUrl: 'https://api.moonshot.cn/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 },
	] as Model<Api>[],
	// Moonshot AI (same as kimi, but can have different base URL)
	'moonshot': [
		{ id: 'moonshot-v1-8k', name: 'Moonshot V1 8K', api: 'openai-completions', provider: 'moonshot', baseUrl: 'https://api.moonshot.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 4096 },
		{ id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', api: 'openai-completions', provider: 'moonshot', baseUrl: 'https://api.moonshot.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 16384 },
		{ id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', api: 'openai-completions', provider: 'moonshot', baseUrl: 'https://api.moonshot.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 32768 },
	] as Model<Api>[],
	// DeepSeek
	'deepseek': [
		{ id: 'deepseek-chat', name: 'DeepSeek Chat', api: 'openai-completions', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 4096 },
		{ id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', api: 'openai-completions', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', reasoning: true, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 4096 },
		{ id: 'deepseek-coder', name: 'DeepSeek Coder', api: 'openai-completions', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16000, maxTokens: 4096 },
		{ id: 'deepseek-v3', name: 'DeepSeek V3', api: 'openai-completions', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 4096 },
	] as Model<Api>[],
	// xAI (Grok)
	'xai': [
		{ id: 'grok-2', name: 'Grok 2', api: 'openai-completions', provider: 'xai', baseUrl: 'https://api.x.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 8192 },
		{ id: 'grok-2-vision', name: 'Grok 2 Vision', api: 'openai-completions', provider: 'xai', baseUrl: 'https://api.x.ai/v1', reasoning: false, input: ['text', 'image'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 },
		{ id: 'grok-beta', name: 'Grok Beta', api: 'openai-completions', provider: 'xai', baseUrl: 'https://api.x.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 8192 },
		{ id: 'grok-vision-beta', name: 'Grok Vision Beta', api: 'openai-completions', provider: 'xai', baseUrl: 'https://api.x.ai/v1', reasoning: false, input: ['text', 'image'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 },
	] as Model<Api>[],
	// Cerebras
	'cerebras': [
		{ id: 'llama-3.3-70b', name: 'Llama 3.3 70B', api: 'openai-completions', provider: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 4096 },
		{ id: 'llama-3.1-70b', name: 'Llama 3.1 70B', api: 'openai-completions', provider: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
		{ id: 'llama-3.1-8b', name: 'Llama 3.1 8B', api: 'openai-completions', provider: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
	] as Model<Api>[],
	// Mistral
	'mistral': [
		{ id: 'mistral-large-latest', name: 'Mistral Large', api: 'openai-completions', provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
		{ id: 'mistral-small-latest', name: 'Mistral Small', api: 'openai-completions', provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1', reasoning: false, input: ['text'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
		{ id: 'pixtral-large-latest', name: 'Pixtral Large', api: 'openai-completions', provider: 'mistral', baseUrl: 'https://api.mistral.ai/v1', reasoning: false, input: ['text', 'image'], cost: { input: 0.0, output: 0.0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
	] as Model<Api>[],
	// Ollama (local)
	'ollama': [
		{ id: 'llama3', name: 'Llama 3', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 4096 },
		{ id: 'llama3.1', name: 'Llama 3.1', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
		{ id: 'llama3.2', name: 'Llama 3.2', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 },
		{ id: 'qwen2.5', name: 'Qwen 2.5', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 },
		{ id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 },
		{ id: 'mistral', name: 'Mistral', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 4096 },
		{ id: 'phi3', name: 'Phi-3', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 4096 },
		{ id: 'codellama', name: 'CodeLlama', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16384, maxTokens: 4096 },
		{ id: 'deepseek-llm', name: 'DeepSeek LLM', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 },
		{ id: 'deepseek-coder', name: 'DeepSeek Coder', api: 'openai-completions', provider: 'ollama', baseUrl: `${OLLAMA_API_BASE}/v1`, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16384, maxTokens: 4096 },
	] as Model<Api>[],
};

/** Provider information for UI display */
export interface ProviderInfo {
	id: string;
	name: string;
	envKey: string;
	authType: 'api_key' | 'oauth' | 'token';
	supportsOAuth: boolean;
	baseUrl?: string;
	logo?: string;
}

export const PROVIDER_INFO: Record<string, ProviderInfo> = {
	'openai': { id: 'openai', name: 'OpenAI', envKey: 'OPENAI_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.openai.com/v1' },
	'anthropic': { id: 'anthropic', name: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://api.anthropic.com' },
	'google': { id: 'google', name: 'Google', envKey: 'GOOGLE_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://generativelanguage.googleapis.com/v1' },
	'google-gemini-cli': { id: 'google-gemini-cli', name: 'Google Gemini CLI', envKey: 'GOOGLE_GEMINI_CLI_API_KEY', authType: 'oauth', supportsOAuth: true },
	'google-antigravity': { id: 'google-antigravity', name: 'Google Antigravity', envKey: '', authType: 'oauth', supportsOAuth: true },
	'github-copilot': { id: 'github-copilot', name: 'GitHub Copilot', envKey: 'GITHUB_COPILOT_TOKEN', authType: 'token', supportsOAuth: true },
	'openai-codex': { id: 'openai-codex', name: 'OpenAI Codex', envKey: 'OPENAI_CODEX_API_KEY', authType: 'api_key', supportsOAuth: true },
	'qwen': { id: 'qwen', name: 'Qwen (通义千问)', envKey: 'QWEN_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
	'kimi': { id: 'kimi', name: 'Kimi (月之暗面)', envKey: 'KIMI_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://api.moonshot.cn/v1' },
	'moonshot': { id: 'moonshot', name: 'Moonshot AI', envKey: 'MOONSHOT_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.moonshot.ai/v1' },
	'minimax': { id: 'minimax', name: 'MiniMax', envKey: 'MINIMAX_API_KEY', authType: 'api_key', supportsOAuth: true, baseUrl: 'https://api.minimax.io/v1' },
	'minimax-cn': { id: 'minimax-cn', name: 'MiniMax CN (国内)', envKey: 'MINIMAX_CN_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.minimaxi.com/v1' },
	'deepseek': { id: 'deepseek', name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.deepseek.com/v1' },
	'groq': { id: 'groq', name: 'Groq', envKey: 'GROQ_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.groq.com/openai/v1' },
	'openrouter': { id: 'openrouter', name: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://openrouter.ai/api/v1' },
	'xai': { id: 'xai', name: 'xAI (Grok)', envKey: 'XAI_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.x.ai/v1' },
	'cerebras': { id: 'cerebras', name: 'Cerebras', envKey: 'CEREBRAS_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.cerebras.ai/v1' },
	'mistral': { id: 'mistral', name: 'Mistral AI', envKey: 'MISTRAL_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'https://api.mistral.ai/v1' },
	'ollama': { id: 'ollama', name: 'Ollama (Local)', envKey: 'OLLAMA_API_KEY', authType: 'api_key', supportsOAuth: false, baseUrl: 'http://127.0.0.1:11434/v1' },
	'azure-openai': { id: 'azure-openai', name: 'Azure OpenAI', envKey: 'AZURE_OPENAI_API_KEY', authType: 'api_key', supportsOAuth: false },
	'amazon-bedrock': { id: 'amazon-bedrock', name: 'Amazon Bedrock', envKey: '', authType: 'api_key', supportsOAuth: false },
	'google-vertex': { id: 'google-vertex', name: 'Google Vertex AI', envKey: '', authType: 'oauth', supportsOAuth: true },
	'huggingface': { id: 'huggingface', name: 'Hugging Face', envKey: 'HF_TOKEN', authType: 'token', supportsOAuth: false, baseUrl: 'https://api-inference.huggingface.co' },
	'vercel-ai-gateway': { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', envKey: '', authType: 'api_key', supportsOAuth: false },
	'zai': { id: 'zai', name: 'ZAI', envKey: 'ZAI_API_KEY', authType: 'api_key', supportsOAuth: false },
	'opencode': { id: 'opencode', name: 'OpenCode', envKey: 'OPENCODE_API_KEY', authType: 'api_key', supportsOAuth: false },
};

/** OAuth provider refresh functions */
const oauthRefreshFunctions: Map<string, (credentials: OAuthCredentials) => Promise<OAuthCredentials>> = new Map();

/** Register OAuth refresh function for a provider */
export function registerOAuthRefresh(provider: string, fn: (credentials: OAuthCredentials) => Promise<OAuthCredentials>): void {
	oauthRefreshFunctions.set(provider, fn);
}

export class ModelRegistry {
	private models: Model<Api>[] = [];
	private config: Config | null = null;
	private _error: string | undefined;
	private ollamaEnabled: boolean = true;
	private ollamaDiscovery: boolean = true;
	private ollamaModels: Model<Api>[] = [];
	private authStorage: AuthStorage | null = null;
	private useAuthProfiles: boolean = true;

	constructor(
		config?: Config | null,
		options?: { ollamaEnabled?: boolean; ollamaDiscovery?: boolean; authStorage?: AuthStorage | null; useAuthProfiles?: boolean }
	) {
		this.config = config ?? null;
		this.ollamaEnabled = options?.ollamaEnabled ?? true;
		this.ollamaDiscovery = options?.ollamaDiscovery ?? true;
		this.authStorage = options?.authStorage ?? null;
		this.useAuthProfiles = options?.useAuthProfiles ?? true;
		this.loadModels();
	}

	/**
	 * Set AuthStorage instance for OAuth/API key resolution.
	 */
	setAuthStorage(authStorage: AuthStorage | null): void {
		this.authStorage = authStorage;
	}

	/**
	 * Enable/disable auth profiles (default: true)
	 */
	setUseAuthProfiles(enabled: boolean): void {
		this.useAuthProfiles = enabled;
	}

	/**
	 * Get API key for a provider (supports OAuth, AuthProfiles, and API keys).
	 */
	async getApiKey(provider: string): Promise<string | undefined> {
		// Try AuthProfiles first (new architecture)
		if (this.useAuthProfiles) {
			const profiles = listProfilesForProvider(provider);
			if (profiles.length > 0) {
				// Try first profile with valid auth
				for (const profile of profiles) {
					if (profile.hasKey) {
						const key = await resolveApiKeyForProfile(
							profile.profileId,
							oauthRefreshFunctions.get(provider)
						);
						if (key) return key;
					}
				}
			}
		}

		// Try AuthStorage (legacy)
		if (this.authStorage) {
			const key = await this.authStorage.getApiKey(provider);
			if (key) return key;
		}

		// Fall back to config
		if (this.config) {
			return getConfigApiKey(this.config, provider) ?? undefined;
		}

		// Fall back to environment variable
		const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
		return process.env[envKey];
	}

	private loadModels(): void {
		this.loadBuiltInModels();

		// Load additional builtin models
		this.loadBuiltinProviderModels();

		if (this.config) {
			this.applyProviderOverrides();
		}

		// Auto-discover Ollama models (async)
		if (this.ollamaEnabled && this.ollamaDiscovery) {
			this.discoverLocalModels();
		}
	}

	private loadBuiltInModels(): void {
		try {
			const providers = getProviders() as string[];
			for (const provider of providers) {
				const builtInModels = getModels(provider as KnownProvider) as Model<Api>[];
				this.models.push(...builtInModels);
			}
		} catch (error) {
			console.warn('Failed to load built-in models:', error);
		}
	}

	private loadBuiltinProviderModels(): void {
		for (const [provider, models] of Object.entries(BUILTIN_PROVIDER_MODELS)) {
			// Check if we already have models from pi-ai for this provider
			const existingProviders = new Set(this.models.map(m => m.provider));
			
			// Only add if pi-ai doesn't have models for this provider, or add to existing
			for (const model of models) {
				const exists = this.models.some(
					m => m.provider === model.provider && m.id === model.id
				);
				if (!exists) {
					this.models.push(model);
				}
			}
		}
	}

	private applyProviderOverrides(): void {
		if (!this.config) return;

		const providers = this.config.providers as Record<string, ProviderOverride>;

		for (const [providerName, providerConfig] of Object.entries(providers)) {
			if (providerConfig.baseUrl) {
				this.models = this.models.map((m) => {
					if (m.provider === providerName) {
						return { ...m, baseUrl: providerConfig.baseUrl! };
					}
					return m;
				});
			}

			if (providerConfig.models && providerConfig.models.length > 0) {
				const api = (providerConfig.api ?? 'openai-completions') as Api;
				const baseUrl = providerConfig.baseUrl ?? getApiBase(this.config, providerName) ?? '';

				for (const modelId of providerConfig.models) {
					const exists = this.models.some((m) => m.provider === providerName && m.id === modelId);
					if (!exists) {
						this.models.push({
							id: modelId,
							name: modelId,
							api,
							provider: providerName,
							baseUrl,
							reasoning: false,
							input: ['text'],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128000,
							maxTokens: 16384,
						} as Model<Api>);
					}
				}
			}
		}
	}

	private async discoverLocalModels(): Promise<void> {
		try {
			this.ollamaModels = await discoverOllamaModels();
			if (this.ollamaModels.length > 0) {
				const existingIds = new Set(this.models.filter((m) => m.provider === 'ollama').map((m) => m.id));
				const newModels = this.ollamaModels.filter((m) => !existingIds.has(m.id));
				this.models.push(...newModels);
			}
		} catch {
			// Ignore discovery errors
		}
	}

	updateConfig(config: Config): void {
		this.config = config;
		this.models = [];
		this._error = undefined;
		this.loadModels();
	}

	async refreshAsync(): Promise<void> {
		this.models = [];
		this._error = undefined;
		this.loadBuiltInModels();
		this.loadBuiltinProviderModels();
		if (this.config) {
			this.applyProviderOverrides();
		}
		if (this.ollamaEnabled && this.ollamaDiscovery) {
			await this.discoverLocalModels();
		}
	}

	/** Get all models (built-in + custom + Ollama) */
	getAll(): Model<Api>[] {
		return this.models;
	}

	/** Get models grouped by provider */
	getByProvider(): Map<string, Model<Api>[]> {
		const byProvider = new Map<string, Model<Api>[]>();
		for (const model of this.models) {
			const list = byProvider.get(model.provider) ?? [];
			list.push(model);
			byProvider.set(model.provider, list);
		}
		return byProvider;
	}

	/** Get only models that have auth configured (sync - uses config only) */
	getAvailableSync(): Model<Api>[] {
		if (!this.config) return this.models;

		return this.models.filter((m) => {
			const apiKey = getConfigApiKey(this.config!, m.provider);
			return !!apiKey || m.provider === 'ollama';
		});
	}

	/** Get only models that have auth configured (async - supports OAuth and AuthProfiles) */
	async getAvailable(): Promise<Model<Api>[]> {
		if (!this.config && !this.authStorage && !this.useAuthProfiles) return this.models;

		const available: Model<Api>[] = [];
		
		for (const m of this.models) {
			// Ollama is always available (local)
			if (m.provider === 'ollama') {
				available.push(m);
				continue;
			}

			// Check auth via AuthProfiles (new architecture)
			if (this.useAuthProfiles) {
				const profiles = listProfilesForProvider(m.provider);
				if (profiles.some(p => p.hasKey)) {
					available.push(m);
					continue;
				}
			}

			// Check auth via AuthStorage (legacy)
			if (this.authStorage) {
				const hasAuth = this.authStorage.hasAuth(m.provider);
				if (hasAuth) {
					available.push(m);
					continue;
				}
			}

			// Fall back to config
			if (this.config) {
				const apiKey = getConfigApiKey(this.config, m.provider);
				if (apiKey) {
					available.push(m);
				}
			}
		}

		return available;
	}

	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find(
			(m) =>
				m.provider.toLowerCase() === provider.toLowerCase() &&
				m.id.toLowerCase() === modelId.toLowerCase()
		);
	}

	findByRef(ref: string): Model<Api> | undefined {
		const slashIndex = ref.indexOf('/');
		if (slashIndex === -1) {
			return this.models.find((m) => m.id.toLowerCase() === ref.toLowerCase());
		}
		const provider = ref.substring(0, slashIndex);
		const modelId = ref.substring(slashIndex + 1);
		return this.find(provider, modelId);
	}

	getError(): string | undefined {
		return this._error;
	}

	refresh(): void {
		this.models = [];
		this._error = undefined;
		this.loadModels();
	}

	async isOllamaAvailable(): Promise<boolean> {
		return isOllamaRunning();
	}

	async getOllamaModels(): Promise<Model<Api>[]> {
		return discoverOllamaModels();
	}

	/** Check if model has auth configured (sync - uses config only) */
	hasAuth(provider: string): boolean {
		// Check AuthProfiles first
		if (this.useAuthProfiles) {
			const profiles = listProfilesForProvider(provider);
			if (profiles.some(p => p.hasKey)) {
				return true;
			}
		}
		// Check AuthStorage
		if (this.authStorage && this.authStorage.hasAuth(provider)) {
			return true;
		}
		// Fall back to config
		if (!this.config) return false;
		return !!getConfigApiKey(this.config, provider);
	}

	/** Check if model has auth configured (async - supports OAuth and AuthProfiles) */
	async hasAuthAsync(provider: string): Promise<boolean> {
		// Check AuthProfiles first
		if (this.useAuthProfiles) {
			const profiles = listProfilesForProvider(provider);
			for (const profile of profiles) {
				if (profile.hasKey) {
					if (profile.expires && Date.now() >= profile.expires) {
						continue; // Token expired
					}
					return true;
				}
			}
		}
		// Check AuthStorage
		if (this.authStorage) {
			return this.authStorage.hasAuth(provider);
		}
		// Fall back to config
		if (!this.config) return false;
		return !!getConfigApiKey(this.config, provider);
	}

	/** Get provider info */
	static getProviderInfo(provider: string): ProviderInfo | undefined {
		return PROVIDER_INFO[provider];
	}

	/** Get all provider infos */
	static getAllProviderInfo(): ProviderInfo[] {
		return Object.values(PROVIDER_INFO);
	}
}

export function resolveConfigValue(value: string): string {
	const match = /^\$\{([A-Z0-9_]+)\}$/.exec(value);
	return match ? process.env[match[1]] ?? value : value;
}
