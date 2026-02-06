/**
 * Models CLI Command
 * 
 * Manage LLM models configuration.
 * Commands:
 *   - list: List available models
 *   - set: Set default model
 *   - add: Add custom provider/model
 *   - remove: Remove custom provider/model
 */

import { Command } from 'commander';
import { ModelRegistry, resolveConfigValue } from '../providers/registry.js';
import { Config, ConfigSchema, getWorkspacePath, listBuiltinModels, parseModelId } from '../config/schema.js';
import { loadConfig, saveConfig } from '../config/index.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function createModelsCommand() {
	const cmd = new Command('models')
		.description('Manage LLM models')
		.addCommand(createListCommand())
		.addCommand(createSetCommand())
		.addCommand(createAddCommand())
		.addCommand(createRemoveCommand())
		.addCommand(createAuthCommand());

	return cmd;
}

function getConfigPath(): string {
	return join(getWorkspacePath(ConfigSchema.parse({})), 'config.json');
}

function loadUserConfig(): Config {
	const configPath = getConfigPath();
	if (existsSync(configPath)) {
		try {
			const content = readFileSync(configPath, 'utf-8');
			const parsed = JSON.parse(content);
			return ConfigSchema.parse(parsed);
		} catch (e) {
			console.warn('Failed to load config, using defaults');
		}
	}
	return ConfigSchema.parse({});
}

function saveUserConfig(config: Config): void {
	const configPath = getConfigPath();
	const dir = require('path').dirname(configPath);
	if (!existsSync(dir)) {
		require('fs').mkdirSync(dir, { recursive: true });
	}
	// 保留注释和格式
	let content = JSON.stringify(config, null, 2);
	writeFileSync(configPath, content);
}

function createListCommand() {
	return new Command('list')
		.description('List available models')
		.option('-a, --all', 'Show all models including unavailable')
		.option('-j, --json', 'Output as JSON')
		.action(async (options) => {
			const config = loadUserConfig();
			const registry = new ModelRegistry(config);
			const models = registry.getAll();

			if (options.json) {
				console.log(JSON.stringify(models.map((m) => ({
					id: m.id,
					provider: m.provider,
					name: m.name,
					contextWindow: m.contextWindow,
					maxTokens: m.maxTokens,
					reasoning: m.reasoning,
					input: m.input,
				})), null, 2));
				return;
			}

			// Group by provider
			const byProvider = new Map<string, typeof models>();
			for (const model of models) {
				const list = byProvider.get(model.provider) ?? [];
				list.push(model);
				byProvider.set(model.provider, list);
			}

			console.log('\n📋 Available Models\n');

			const availableProviders = new Set<string>();
			for (const model of models) {
				if (registry.hasAuth(model.provider)) {
					availableProviders.add(model.provider);
				}
			}

			for (const [provider, providerModels] of byProvider) {
				const isAvailable = availableProviders.has(provider);
				const status = isAvailable ? '✅' : '❌';

				console.log(`  ${status} ${provider}`);

				for (const model of providerModels) {
					const icon = '  •';
					const reasoning = model.reasoning ? ' 🧠' : '';
					console.log(`${icon} ${model.id}${reasoning}`);
				}
			}

			console.log('\n💡 Tip: Set API key in environment or config.json to enable models');
			console.log('   Example: export OPENAI_API_KEY="sk-..."');
		});
}

function createSetCommand() {
	return new Command('set')
		.description('Set the default model')
		.argument('<model-ref>', 'Model reference (e.g., openai/gpt-4o)')
		.action(async (modelRef) => {
			const config = loadUserConfig();
			const registry = new ModelRegistry(config);
			const model = registry.findByRef(modelRef);

			if (!model) {
				console.error(`❌ Model not found: ${modelRef}`);
				console.log('\nAvailable models: xopcbot models list');
				process.exit(1);
			}

			config.agents.defaults.model = `${model.provider}/${model.id}`;
			saveUserConfig(config);

			console.log(`✅ Set default model to: ${model.provider}/${model.id}`);
			console.log(`   Context Window: ${model.contextWindow.toLocaleString()} tokens`);
			console.log(`   Max Output: ${model.maxTokens.toLocaleString()} tokens`);
			console.log(`   Reasoning: ${model.reasoning ? 'Yes' : 'No'}`);
		});
}

function createAddCommand() {
	return new Command('add')
		.description('Add a custom model to provider config')
		.option('--provider <name>', 'Provider name')
		.option('--baseUrl <url>', 'API base URL (optional)')
		.option('--apiKey <key>', 'API key (or ${ENV_VAR})')
		.option('--api <type>', 'API type (openai-completions, anthropic-messages)')
		.option('--model <id>', 'Model ID to add')
		.action(async (options) => {
			const config = loadUserConfig();
			const providerName = options.provider;

			if (!providerName) {
				console.error('❌ --provider is required');
				process.exit(1);
			}

			const modelId = options.model;
			if (!modelId) {
				console.error('❌ --model is required');
				process.exit(1);
			}

			// Ensure provider exists
			if (!config.providers[providerName]) {
				(config.providers as Record<string, any>)[providerName] = {};
			}

			const providerConfig = (config.providers as Record<string, any>)[providerName];

			// Update baseUrl if provided
			if (options.baseUrl) {
				providerConfig.baseUrl = resolveConfigValue(options.baseUrl);
			}

			// Update apiKey if provided
			if (options.apiKey) {
				providerConfig.apiKey = resolveConfigValue(options.apiKey);
			}

			// Update api type if provided
			if (options.api) {
				providerConfig.api = options.api;
			}

			// Add model to list
			if (!providerConfig.models) {
				providerConfig.models = [];
			}

			if (!providerConfig.models.includes(modelId)) {
				providerConfig.models.push(modelId);
			}

			saveUserConfig(config);
			console.log(`✅ Added model "${modelId}" to provider: ${providerName}`);
			console.log(`   Config saved to: ${getConfigPath()}`);
		});
}

function createRemoveCommand() {
	return new Command('remove')
		.description('Remove a custom model from provider config')
		.argument('<target>', 'Provider or model to remove (provider or provider/model)')
		.action(async (target) => {
			const config = loadUserConfig();
			const [provider, modelId] = target.split('/');

			if (!config.providers[provider]) {
				console.error(`❌ Provider not found: ${provider}`);
				process.exit(1);
			}

			const providerConfig = (config.providers as Record<string, any>)[provider];

			if (modelId) {
				// Remove specific model
				const models = providerConfig.models ?? [];
				const filtered = models.filter((m: string) => m !== modelId);
				if (models.length === filtered.length) {
					console.error(`❌ Model not found: ${target}`);
					process.exit(1);
				}
				providerConfig.models = filtered;
				console.log(`✅ Removed model: ${target}`);
			} else {
				// Remove entire provider (reset to default)
				delete config.providers[provider];
				console.log(`✅ Removed provider config: ${provider}`);
			}

			saveUserConfig(config);
		});
}

function createAuthCommand() {
	return new Command('auth')
		.description('Manage API authentication')
		.addCommand(new Command('set')
			.description('Set API key for a provider')
			.argument('<provider>', 'Provider name')
			.argument('<apiKey>', 'API key (or ${ENV_VAR})')
			.action(async (provider, apiKey) => {
				const config = loadUserConfig();
				const resolvedKey = resolveConfigValue(apiKey);

				if (!config.providers[provider]) {
					(config.providers as Record<string, any>)[provider] = {};
				}
				(config.providers as Record<string, any>)[provider].apiKey = resolvedKey;

				saveUserConfig(config);
				console.log(`✅ Set API key for: ${provider}`);
			}))
		.addCommand(new Command('list')
			.description('List configured auth')
			.action(async () => {
				const config = loadUserConfig();
				console.log('\n🔐 Configured Providers:\n');

				const providers = Object.keys(config.providers);
				if (providers.length === 0) {
					console.log('   No providers configured in config.json');
					console.log('   Use environment variables or set via: xopcbot models auth set <provider> <key>');
					return;
				}

				for (const provider of providers) {
					const hasKey = !!(config.providers as Record<string, any>)[provider]?.apiKey;
					console.log(`  ${hasKey ? '✅' : '❌'} ${provider}`);
				}
			}));
}
