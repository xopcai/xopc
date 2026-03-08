import { buildRegistry, getConfiguredProviderIds, getProvider, getAllProviderIds } from './models-loader.js';

export interface DiscoveredProvider {
	id: string;
	name: string;
	configured: boolean;
	apiKey?: string;
	baseUrl?: string;
}

export interface AutoConfig {
	defaultModel: string;
	enabledProviders: string[];
	providerConfigs: Record<string, { apiKey?: string; baseUrl?: string }>;
}

export function scanProviders(): {
	configured: DiscoveredProvider[];
	unconfigured: DiscoveredProvider[];
} {
	const configured: DiscoveredProvider[] = [];
	const unconfigured: DiscoveredProvider[] = [];
	const registry = buildRegistry();

	for (const provider of registry) {
		const isConfigured = provider.configured;

		const info: DiscoveredProvider = {
			id: provider.id,
			name: provider.name,
			configured: isConfigured,
			apiKey: undefined,
			baseUrl: provider.baseUrl,
		};

		if (isConfigured) {
			configured.push(info);
		} else {
			unconfigured.push(info);
		}
	}

	return { configured, unconfigured };
}

export function recommendDefaultModel(configuredProviders: string[]): string {
	const priority = [
		{ provider: 'openai', model: 'gpt-4o' },
		{ provider: 'anthropic', model: 'claude-sonnet-4-5' },
		{ provider: 'google', model: 'gemini-2.5-pro' },
		{ provider: 'qwen', model: 'qwen-plus' },
		{ provider: 'kimi', model: 'kimi-k2.5' },
		{ provider: 'minimax', model: 'minimax-m2.5' },
		{ provider: 'deepseek', model: 'deepseek-chat' },
		{ provider: 'groq', model: 'llama-3.3-70b' },
	];

	for (const { provider, model } of priority) {
		if (configuredProviders.includes(provider)) {
			return `${provider}/${model}`;
		}
	}

	if (configuredProviders.length > 0) {
		const first = configuredProviders[0];
		const provider = getProvider(first);
		if (provider) {
			return `${first}/${provider.defaults.maxTokens > 4000 ? 'default' : 'default'}`;
		}
	}

	return 'openai/gpt-4o';
}

export function generateAutoConfig(): AutoConfig {
	const providerIds = getConfiguredProviderIds();

	const providerConfigs: Record<string, { apiKey?: string; baseUrl?: string }> = {};
	for (const providerId of providerIds) {
		providerConfigs[providerId] = { apiKey: '${ENV}' };
	}

	return {
		defaultModel: recommendDefaultModel(providerIds),
		enabledProviders: providerIds,
		providerConfigs,
	};
}

export function generateConfigTemplate(): string {
	const autoConfig = generateAutoConfig();
	
	const config = {
		agents: {
			defaults: {
				model: autoConfig.defaultModel,
				maxTokens: 8192,
				temperature: 0.7,
			},
		},
		providers: autoConfig.providerConfigs,
	};

	return JSON.stringify(config, null, 2);
}

export interface QuickSetupResult {
	success: boolean;
	message: string;
	defaultModel?: string;
	providers?: string[];
	errors?: string[];
}

export function quickSetup(): QuickSetupResult {
	const { configured, unconfigured } = scanProviders();

	if (configured.length === 0) {
		const suggestions = unconfigured
			.slice(0, 5)
			.map(p => `  - ${p.name}: ${getProvider(p.id)?.auth.envKeys.join(' or ')}`)
			.join('\n');

		return {
			success: false,
			message: `No provider configuration detected.\n\nPlease set one of the following environment variables:\n${suggestions}`,
			errors: ['NO_PROVIDERS_CONFIGURED'],
		};
	}

	const defaultModel = recommendDefaultModel(configured.map(p => p.id));
	const providerNames = configured.map(p => p.name).join(', ');

	return {
		success: true,
		message: `Detected ${configured.length} configured providers: ${providerNames}\nRecommended default model: ${defaultModel}`,
		defaultModel,
		providers: configured.map(p => p.id),
	};
}

export function isModelAvailable(modelRef: string): boolean {
	const [providerId, _modelId] = modelRef.includes('/')
		? modelRef.split('/')
		: [undefined, modelRef];

	if (!providerId) {
		for (const id of getAllProviderIds()) {
			if (getProvider(id)?.configured) {
				return true;
			}
		}
		return false;
	}

	return !!getProvider(providerId)?.configured;
}

export function getBestAvailableModel(): string | undefined {
	const candidates = [
		'openai/gpt-4o',
		'anthropic/claude-sonnet-4-5',
		'google/gemini-2.5-pro',
		'qwen/qwen-plus',
		'kimi/kimi-k2.5',
		'minimax/minimax-m2.5',
		'deepseek/deepseek-chat',
	];

	for (const model of candidates) {
		if (isModelAvailable(model)) {
			return model;
		}
	}

	const configured = getConfiguredProviderIds();
	if (configured.length > 0) {
		return `${configured[0]}/default`;
	}

	return undefined;
}

export function printDiagnostic(): void {
	console.log('\n🔍 Provider Configuration Diagnostic\n');
	console.log('=' .repeat(50));

	const { configured, unconfigured } = scanProviders();

	console.log('\n✅ Configured Providers:');
	if (configured.length === 0) {
		console.log('   (none)');
	} else {
		for (const p of configured) {
			console.log(`   • ${p.name} (${p.id})`);
			console.log(`     API Key: ${p.apiKey}`);
			console.log(`     Base URL: ${p.baseUrl}`);
		}
	}

	console.log('\n⚠️  Unconfigured Providers (first 10):');
	for (const p of unconfigured.slice(0, 10)) {
		const provider = getProvider(p.id);
		const envKeys = provider?.auth.envKeys.join(' or ') || 'N/A';
		console.log(`   • ${p.name}: ${envKeys}`);
	}

	if (unconfigured.length > 10) {
		console.log(`   ... ${unconfigured.length - 10} more`);
	}

	console.log('\n📋 Recommended Configuration:');
	const quick = quickSetup();
	if (quick.success) {
		console.log(`   Default Model: ${quick.defaultModel}`);
		console.log(`   Available Providers: ${quick.providers?.join(', ')}`);
	} else {
		console.log(`   ${quick.message}`);
	}

	console.log('\n' + '='.repeat(50) + '\n');
}

export function getConfigSummary(): {
	status: 'ready' | 'no_providers';
	providers: number;
	defaultModel?: string;
	message: string;
} {
	const configured = getConfiguredProviderIds();
	
	if (configured.length === 0) {
		return {
			status: 'no_providers',
			providers: 0,
			message: 'No provider configured, please set environment variables',
		};
	}

	const defaultModel = getBestAvailableModel();
	return {
		status: 'ready',
		providers: configured.length,
		defaultModel,
		message: `${configured.length} providers configured, default model: ${defaultModel}`,
	};
}
