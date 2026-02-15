/**
 * Auth Command
 * 
 * Manage authentication credentials (API keys, OAuth tokens).
 */

import { Command } from 'commander';
import { AuthStorage, anthropicOAuthProvider, type OAuthLoginCallbacks } from '../../auth/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { homedir } from 'os';
import { join } from 'path';

const log = createLogger('AuthCommand');

// Create a shared AuthStorage instance
function getAuthStorage(): AuthStorage {
	const authPath = join(homedir(), '.xopcbot', 'auth.json');
	const storage = new AuthStorage({ filename: authPath });
	// Register OAuth providers
	storage.registerOAuthProvider(anthropicOAuthProvider);
	return storage;
}

function createAuthCommand(ctx: CLIContext): Command {
	const cmd = new Command('auth')
		.description('Manage authentication credentials')
		.addHelpText(
			'after',
			formatExamples([
				'xopcbot auth list',
				'xopcbot auth set openai sk-xxx',
				'xopcbot auth set anthropic sk-ant-api-xxx',
				'xopcbot auth login anthropic',
				'xopcbot auth logout anthropic',
				'xopcbot auth remove anthropic',
			])
		);

	// List command
	cmd
		.command('list')
		.description('List all configured authentication credentials')
		.action(() => {
			const storage = getAuthStorage();
			const configured = storage.getConfiguredProviders();
			
			if (configured.length === 0) {
				log.info('No authentication credentials configured.');
				log.info('Set an API key: xopcbot auth set <provider> <key>');
				log.info('Or login with OAuth: xopcbot auth login <provider>');
				return;
			}

			console.log('\nConfigured authentication providers:\n');
			for (const provider of configured) {
				const type = storage.getCredentialType(provider) || 'unknown';
				const hasAuth = storage.hasAuth(provider);
				const status = hasAuth ? '✅ Configured' : '❌ Missing';
				console.log(`  ${provider.padEnd(20)} ${type.padEnd(10)} ${status}`);
			}
			console.log('');
		});

	// Set command
	cmd
		.command('set <provider> <key>')
		.description('Set API key for a provider')
		.action((provider: string, key: string) => {
			const storage = getAuthStorage();
			storage.setApiKey(provider, key);
			log.info(`API key set for provider: ${provider}`);
		});

	// Get command
	cmd
		.command('get <provider>')
		.description('Get API key for a provider (shows masked)')
		.action(async (provider: string) => {
			const storage = getAuthStorage();
			const key = await storage.getApiKey(provider);
			
			if (!key) {
				log.error(`No API key found for provider: ${provider}`);
				process.exit(1);
			}

			// Mask the key
			const masked = key.length > 8 
				? `${key.substring(0, 4)}${'*'.repeat(key.length - 8)}${key.substring(key.length - 4)}`
				: '****';
			console.log(`\nProvider: ${provider}`);
			console.log(`API Key: ${masked}\n`);
		});

	// Remove command
	cmd
		.command('remove <provider>')
		.description('Remove authentication for a provider')
		.action((provider: string) => {
			const storage = getAuthStorage();
			const removed = storage.remove(provider);
			if (removed) {
				log.info(`Authentication removed for provider: ${provider}`);
			} else {
				log.warn(`No authentication found for provider: ${provider}`);
			}
		});

	// Login command (OAuth)
	cmd
		.command('login <provider>')
		.description('Login to a provider using OAuth (currently supports: anthropic)')
		.action(async (provider: string) => {
			const storage = getAuthStorage();
			
			if (provider === 'anthropic') {
				log.info('Starting Anthropic OAuth login...');
				log.info('This will open Claude.ai in your browser.');
				
				const callbacks: OAuthLoginCallbacks = {
					onAuth: (info) => {
						console.log('\n📧 Please open this URL in your browser:\n');
						console.log(info.url);
						console.log('\n');
					},
					onPrompt: async (prompt) => {
						const readline = await import('readline');
						const rl = readline.createInterface({
							input: process.stdin,
							output: process.stdout,
						});
						
						return new Promise((resolve) => {
							rl.question(prompt.message + ' ', (answer) => {
								rl.close();
								resolve(answer);
							});
						});
					},
					onProgress: (message) => {
						log.info(message);
					},
				};

				try {
					await storage.login('anthropic', callbacks);
					log.info('✅ OAuth login successful!');
					log.info('Credentials saved to: ' + storage.getAuthPath());
				} catch (error) {
					log.error(`OAuth login failed: ${error}`);
					process.exit(1);
				}
			} else {
				log.error(`Unknown OAuth provider: ${provider}`);
				log.info('Supported OAuth providers: anthropic');
				log.info('Alternatively, set an API key: xopcbot auth set <provider> <key>');
				process.exit(1);
			}
		});

	// Logout command
	cmd
		.command('logout <provider>')
		.description('Logout from a provider (remove OAuth credentials)')
		.action((provider: string) => {
			const storage = getAuthStorage();
			const hadCredentials = storage.hasAuth(provider);
			
			storage.logout(provider);
			
			if (hadCredentials) {
				log.info(`Logged out from provider: ${provider}`);
			} else {
				log.warn(`No credentials found for provider: ${provider}`);
			}
		});

	// Clear command
	cmd
		.command('clear')
		.description('Clear all authentication credentials')
		.action(() => {
			const storage = getAuthStorage();
			storage.clear();
			log.info('All authentication credentials cleared.');
		});

	return cmd;
}

// Register the command
register({
	id: 'auth',
	name: 'auth',
	description: 'Manage authentication credentials',
	factory: createAuthCommand,
	metadata: { 
		category: 'setup',
		examples: [
			'xopcbot auth list',
			'xopcbot auth set openai sk-xxx',
			'xopcbot auth login anthropic',
		],
	},
});
