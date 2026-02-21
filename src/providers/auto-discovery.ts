/**
 * Auto Discovery
 * 
 * 自动检测和配置 Provider
 * - 从环境变量自动检测已配置的 provider
 * - 生成简化配置
 * - 无需手动编辑 config.json
 */

import {
	getConfiguredProviders,
	getProviderApiKey,
	getProvider,
	PROVIDER_CATALOG,
} from './provider-catalog.js';

export interface DiscoveredProvider {
	id: string;
	name: string;
	configured: boolean;
	apiKey?: string;
	baseUrl?: string;
}

export interface AutoConfig {
	/** 默认模型 */
	defaultModel: string;
	/** 启用的 providers */
	enabledProviders: string[];
	/** 完整的 provider 配置 */
	providerConfigs: Record<string, { apiKey?: string; baseUrl?: string }>;
}

/**
 * 扫描所有 provider，返回已配置和未配置的列表
 */
export function scanProviders(): {
	configured: DiscoveredProvider[];
	unconfigured: DiscoveredProvider[];
} {
	const configured: DiscoveredProvider[] = [];
	const unconfigured: DiscoveredProvider[] = [];

	for (const [id, provider] of Object.entries(PROVIDER_CATALOG)) {
		const apiKey = getProviderApiKey(id);
		const isConfigured = !!apiKey;

		const info: DiscoveredProvider = {
			id,
			name: provider.name,
			configured: isConfigured,
			apiKey: isConfigured ? '***' + apiKey.slice(-4) : undefined,
			baseUrl: provider.api.baseUrl,
		};

		if (isConfigured) {
			configured.push(info);
		} else {
			unconfigured.push(info);
		}
	}

	return { configured, unconfigured };
}

/**
 * 推荐默认模型
 * 根据已配置的 provider 选择最佳默认模型
 */
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

	// 如果没有优先列表中的 provider，使用第一个
	if (configuredProviders.length > 0) {
		const first = configuredProviders[0];
		const provider = getProvider(first);
		if (provider) {
			return `${first}/${provider.defaults.maxTokens > 4000 ? 'default' : 'default'}`;
		}
	}

	return 'openai/gpt-4o';
}

/**
 * 生成自动配置
 * 基于环境变量生成最小化配置
 */
export function generateAutoConfig(): AutoConfig {
	const configured = getConfiguredProviders();
	const providerIds = configured.map(p => p.id);

	const providerConfigs: Record<string, { apiKey?: string; baseUrl?: string }> = {};
	for (const provider of configured) {
		const apiKey = getProviderApiKey(provider.id);
		if (apiKey) {
			providerConfigs[provider.id] = {
				// 不从环境变量读取实际值，只标记为已配置
				// 实际运行时从环境变量读取
				apiKey: '${ENV}',
			};
		}
	}

	return {
		defaultModel: recommendDefaultModel(providerIds),
		enabledProviders: providerIds,
		providerConfigs,
	};
}

/**
 * 生成 config.json 内容（用于显示或导出）
 */
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

/**
 * 快速配置向导结果
 */
export interface QuickSetupResult {
	success: boolean;
	message: string;
	defaultModel?: string;
	providers?: string[];
	errors?: string[];
}

/**
 * 快速配置向导
 * 检测环境并返回配置建议
 */
export function quickSetup(): QuickSetupResult {
	const { configured, unconfigured } = scanProviders();

	if (configured.length === 0) {
		// 列出需要配置的 provider
		const suggestions = unconfigured
			.slice(0, 5)
			.map(p => `  - ${p.name}: ${getProvider(p.id)?.auth.envKeys.join(' 或 ')}`)
			.join('\n');

		return {
			success: false,
			message: `未检测到任何 Provider 配置。\n\n请设置以下环境变量之一：\n${suggestions}`,
			errors: ['NO_PROVIDERS_CONFIGURED'],
		};
	}

	const defaultModel = recommendDefaultModel(configured.map(p => p.id));
	const providerNames = configured.map(p => p.name).join(', ');

	return {
		success: true,
		message: `检测到 ${configured.length} 个已配置 Provider: ${providerNames}\n推荐默认模型: ${defaultModel}`,
		defaultModel,
		providers: configured.map(p => p.id),
	};
}

/**
 * 检查特定模型是否可用
 */
export function isModelAvailable(modelRef: string): boolean {
	const [providerId, _modelId] = modelRef.includes('/')
		? modelRef.split('/')
		: [undefined, modelRef];

	if (!providerId) {
		// 尝试自动检测
		for (const id of Object.keys(PROVIDER_CATALOG)) {
			if (getProviderApiKey(id)) {
				return true; // 假设模型存在
			}
		}
		return false;
	}

	return !!getProviderApiKey(providerId);
}

/**
 * 获取最佳可用模型
 * 按优先级返回第一个可用的模型
 */
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

	// 返回第一个配置的 provider 的默认模型
	const configured = getConfiguredProviders();
	if (configured.length > 0) {
		const first = configured[0];
		return `${first.id}/default`;
	}

	return undefined;
}

/**
 * 打印配置诊断信息
 */
export function printDiagnostic(): void {
	console.log('\n🔍 Provider 配置诊断\n');
	console.log('=' .repeat(50));

	const { configured, unconfigured } = scanProviders();

	console.log('\n✅ 已配置 Provider:');
	if (configured.length === 0) {
		console.log('   (无)');
	} else {
		for (const p of configured) {
			console.log(`   • ${p.name} (${p.id})`);
			console.log(`     API Key: ${p.apiKey}`);
			console.log(`     Base URL: ${p.baseUrl}`);
		}
	}

	console.log('\n⚠️  未配置 Provider (前 10 个):');
	for (const p of unconfigured.slice(0, 10)) {
		const provider = getProvider(p.id);
		const envKeys = provider?.auth.envKeys.join(' 或 ') || 'N/A';
		console.log(`   • ${p.name}: ${envKeys}`);
	}

	if (unconfigured.length > 10) {
		console.log(`   ... 还有 ${unconfigured.length - 10} 个`);
	}

	console.log('\n📋 推荐配置:');
	const quick = quickSetup();
	if (quick.success) {
		console.log(`   默认模型: ${quick.defaultModel}`);
		console.log(`   可用 Providers: ${quick.providers?.join(', ')}`);
	} else {
		console.log(`   ${quick.message}`);
	}

	console.log('\n' + '='.repeat(50) + '\n');
}

/**
 * 获取配置状态摘要
 */
export function getConfigSummary(): {
	status: 'ready' | 'no_providers';
	providers: number;
	defaultModel?: string;
	message: string;
} {
	const configured = getConfiguredProviders();
	
	if (configured.length === 0) {
		return {
			status: 'no_providers',
			providers: 0,
			message: '未配置任何 Provider，请设置环境变量',
		};
	}

	const defaultModel = getBestAvailableModel();
	return {
		status: 'ready',
		providers: configured.length,
		defaultModel,
		message: `已配置 ${configured.length} 个 Provider，默认模型: ${defaultModel}`,
	};
}
