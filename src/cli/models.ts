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
import { ModelRegistry, getApiKey, saveApiKey } from '../providers/registry.js';
import { listAllModels } from '../providers/pi-ai.js';
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

function createListCommand() {
	return new Command('list')
		.description('List available models')
		.option('-a, --all', 'Show all models including unavailable')
		.option('-j, --json', 'Output as JSON')
		.option('--models-json <path>', 'Path to models.json')
		.action(async (options) => {
			const registry = new ModelRegistry(options.modelsJson);
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
				if (getApiKey(model.provider)) {
					availableProviders.add(model.provider);
				}
			}

			for (const [provider, providerModels] of byProvider) {
				const isAvailable = availableProviders.has(provider);
				const status = isAvailable ? '✅' : '❌';

				console.log(`  ${status} ${provider}`);

				for (const model of providerModels) {
					const hasAuth = getApiKey(provider);
					const icon = hasAuth ? '  •' : '   ';
					const reasoning = model.reasoning ? ' 🧠' : '';
					console.log(`${icon} ${model.id}${reasoning}`);
				}
			}

			console.log('\n💡 Tip: Set API key in environment or auth.json to enable models');
			console.log('   Example: export OPENAI_API_KEY="sk-..."');
		});
}

function createSetCommand() {
	return new Command('set')
		.description('Set the default model')
		.argument('<model-ref>', 'Model reference (e.g., openai/gpt-4o)')
		.option('--models-json <path>', 'Path to models.json')
		.action(async (modelRef, options) => {
			const registry = new ModelRegistry(options.modelsJson);
			const model = registry.findByRef(modelRef);

			if (!model) {
				console.error(`❌ Model not found: ${modelRef}`);
				console.log('\nAvailable models: xopcbot models list');
				process.exit(1);
			}

			console.log(`✅ Set default model to: ${model.provider}/${model.id}`);
			console.log(`   Context Window: ${model.contextWindow.toLocaleString()} tokens`);
			console.log(`   Max Output: ${model.maxTokens.toLocaleString()} tokens`);
			console.log(`   Reasoning: ${model.reasoning ? 'Yes' : 'No'}`);
		});
}

function createAddCommand() {
	return new Command('add')
		.description('Add a custom provider or model')
		.option('--provider <name>', 'Provider name')
		.option('--baseUrl <url>', 'API base URL')
		.option('--apiKey <key>', 'API key (or ${ENV_VAR})')
		.option('--api <type>', 'API type (openai-completions, anthropic-messages)')
		.option('--modelId <id>', 'Model ID')
		.option('--modelName <name>', 'Model display name')
		.option('--contextWindow <number>', 'Context window size')
		.option('--maxTokens <number>', 'Max output tokens')
		.option('--reasoning', 'Model supports reasoning')
		.option('--modelsJson <path>', 'Path to models.json')
		.action(async (options) => {
			const modelsJsonPath = options.modelsJson ?? './models.json';

			// Load existing config
			let config = { providers: {} as Record<string, any> };
			if (existsSync(modelsJsonPath)) {
				try {
					config = JSON.parse(readFileSync(modelsJsonPath, 'utf-8'));
				} catch (e) {
					console.error('Failed to parse models.json:', e);
					process.exit(1);
				}
			}

			// Build provider config
			const providerName = options.provider;
			if (!providerName) {
				console.error('❌ --provider is required');
				process.exit(1);
			}

			if (!config.providers[providerName]) {
				config.providers[providerName] = {
					baseUrl: options.baseUrl,
					apiKey: options.apiKey,
					api: options.api ?? 'openai-completions',
					models: [],
				};
			}

			// Add model if specified
			if (options.modelId) {
				config.providers[providerName].models.push({
					id: options.modelId,
					name: options.modelName ?? options.modelId,
					contextWindow: options.contextWindow ? parseInt(options.contextWindow) : 128000,
					maxTokens: options.maxTokens ? parseInt(options.maxTokens) : 16384,
					reasoning: options.reasoning ?? false,
					input: ['text'],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				});
			}

			// Save config
			writeFileSync(modelsJsonPath, JSON.stringify(config, null, 2));
			console.log(`✅ Added/updated provider: ${providerName}`);
			console.log(`   Config saved to: ${modelsJsonPath}`);
		});
}

function createRemoveCommand() {
	return new Command('remove')
		.description('Remove a custom provider or model')
		.argument('<target>', 'Provider or model to remove (provider or provider/model)')
		.option('--models-json <path>', 'Path to models.json')
		.action(async (target, options) => {
			const modelsJsonPath = options.modelsJson ?? './models.json';

			if (!existsSync(modelsJsonPath)) {
				console.error('❌ models.json not found');
				process.exit(1);
			}

			const config = JSON.parse(readFileSync(modelsJsonPath, 'utf-8'));
			const [provider, modelId] = target.split('/');

			if (modelId) {
				// Remove specific model
				const models = config.providers[provider]?.models ?? [];
				const filtered = models.filter((m: any) => m.id !== modelId);
				if (models.length === filtered.length) {
					console.error(`❌ Model not found: ${target}`);
					process.exit(1);
				}
				config.providers[provider].models = filtered;
				console.log(`✅ Removed model: ${target}`);
			} else {
				// Remove entire provider
				if (!config.providers[provider]) {
					console.error(`❌ Provider not found: ${provider}`);
					process.exit(1);
				}
				delete config.providers[provider];
				console.log(`✅ Removed provider: ${provider}`);
			}

			writeFileSync(modelsJsonPath, JSON.stringify(config, null, 2));
		});
}

function createAuthCommand() {
	return new Command('auth')
		.description('Manage API authentication')
		.addCommand(new Command('set')
			.description('Set API key for a provider')
			.argument('<provider>', 'Provider name')
			.argument('<apiKey>', 'API key (or ${ENV_VAR})')
			.option('--file <path>', 'Auth file path')
			.action(async (provider, apiKey, options) => {
				saveApiKey(provider, apiKey, options.file);
				console.log(`✅ Set API key for: ${provider}`);
			}))
		.addCommand(new Command('list')
			.description('List configured auth')
			.option('--file <path>', 'Auth file path')
			.action(async (options) => {
				const { AuthStorage } = await import('../auth/storage.js');
				const storage = new AuthStorage({ dataDir: options.file ? '.' : './data', filename: options.file });
				const configured = storage.getConfiguredProviders();
				console.log('\n🔐 Configured Providers:\n');
				for (const provider of configured) {
					const hasAuth = storage.hasAuth(provider);
					console.log(`  ${hasAuth ? '✅' : '❌'} ${provider}`);
				}
			}));
}
