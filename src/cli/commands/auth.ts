/**
 * Auth Command
 * 
 * Manage authentication credentials (API keys, OAuth tokens, Auth Profiles).
 */

import { Command } from 'commander';
import { AuthStorage, anthropicOAuthProvider, qwenPortalOAuthProvider, minimaxOAuthProvider, kimiOAuthProvider, type OAuthLoginCallbacks } from '../../auth/index.js';
import {
	listProfilesForProvider,
	listAllProfiles,
	upsertAuthProfile,
	removeAuthProfile,
	getProvidersWithProfiles,
	type AuthProfileCredential,
} from '../../auth/profiles/index.js';
import { PROVIDER_INFO, ModelRegistry } from '../../providers/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors, colorizeStatus } from '../utils/colors.js';
import { homedir } from 'os';
import { join } from 'path';

const log = createLogger('AuthCommand');

// OAuth providers map
const oauthProviders: Record<string, { name: string; login: (callbacks: OAuthLoginCallbacks) => Promise<AuthProfileCredential> }> = {
	anthropic: {
		name: 'Anthropic (Claude)',
		login: async (callbacks) => {
			const authPath = join(homedir(), '.xopcbot', 'auth.json');
			const storage = new AuthStorage({ filename: authPath });
			storage.registerOAuthProvider(anthropicOAuthProvider);
			await storage.login('anthropic', callbacks);
			// Convert to AuthProfileCredential
			const creds = storage.getOAuthCredentials('anthropic');
			return {
				type: 'oauth' as const,
				provider: 'anthropic',
				...creds!,
			};
		},
	},
	qwen: {
		name: 'Qwen (通义千问)',
		login: async (callbacks) => {
			const provider = qwenPortalOAuthProvider;
			const creds = await provider.login(callbacks);
			return {
				type: 'oauth' as const,
				provider: 'qwen',
				...creds,
			};
		},
	},
	minimax: {
		name: 'MiniMax (幂维智能)',
		login: async (callbacks) => {
			const provider = minimaxOAuthProvider;
			const creds = await provider.login(callbacks);
			return {
				type: 'oauth' as const,
				provider: 'minimax',
				...creds,
			};
		},
	},
	kimi: {
		name: 'Kimi (月之暗面)',
		login: async (callbacks) => {
			const provider = kimiOAuthProvider;
			const creds = await provider.login(callbacks);
			return {
				type: 'oauth' as const,
				provider: 'kimi',
				...creds,
			};
		},
	},
};

// Create a shared AuthStorage instance (legacy)
function getAuthStorage(): AuthStorage {
	const authPath = join(homedir(), '.xopcbot', 'auth.json');
	const storage = new AuthStorage({ filename: authPath });
	storage.registerOAuthProvider(anthropicOAuthProvider);
	storage.registerOAuthProvider(qwenPortalOAuthProvider);
	storage.registerOAuthProvider(minimaxOAuthProvider);
	storage.registerOAuthProvider(kimiOAuthProvider);
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
				'xopcbot auth login qwen',
				'xopcbot auth logout anthropic',
				'xopcbot auth remove anthropic',
				'xopcbot auth profiles list',
			])
		);

	// List command - shows both legacy auth and AuthProfiles
	cmd
		.command('list')
		.description('List all configured authentication credentials')
		.option('--profiles', 'Show auth profiles instead of legacy auth')
		.action((options) => {
			if (options.profiles) {
				listAuthProfiles();
				return;
			}
			listLegacyAuth();
		});

	// Set command
	cmd
		.command('set <provider> <key>')
		.description('Set API key for a provider')
		.option('-p, --profile <profileId>', 'Profile ID (default: provider:default)')
		.action((provider: string, key: string, options: { profile?: string }) => {
			const profileId = options.profile || `${provider}:default`;
			
			const credential: AuthProfileCredential = {
				type: 'api_key',
				provider,
				key,
			};
			
			upsertAuthProfile({ profileId, credential });
			log.info(`API key set for ${provider} (profile: ${profileId})`);
		});

	// Get command
	cmd
		.command('get <provider>')
		.description('Get API key for a provider (shows masked)')
		.option('-p, --profile <profileId>', 'Profile ID')
		.action(async (provider: string, options: { profile?: string }) => {
			const profiles = listProfilesForProvider(provider);
			
			if (profiles.length === 0) {
				log.error(`No credentials found for provider: ${provider}`);
				// Try legacy auth
				const storage = getAuthStorage();
				const key = await storage.getApiKey(provider);
				if (key) {
					const masked = key.length > 8 
						? `${key.substring(0, 4)}${'*'.repeat(key.length - 8)}${key.substring(key.length - 4)}`
						: '****';
					console.log(`\nProvider: ${provider} (legacy)`);
					console.log(`API Key: ${masked}\n`);
					return;
				}
				process.exit(1);
			}

			for (const profile of profiles) {
				const masked = '****';
				const status = colorizeStatus(profile.hasKey);
				console.log(`\nProvider: ${provider}`);
				console.log(`Profile: ${profile.profileId}`);
				console.log(`Type: ${profile.type}`);
				console.log(`Status: ${status} ${profile.hasKey ? 'Configured' : 'Missing'}`);
				if (profile.expires) {
					const expDate = new Date(profile.expires);
					console.log(`Expires: ${expDate.toLocaleString()}`);
				}
				console.log('');
			}
		});

	// Remove command
	cmd
		.command('remove <provider>')
		.description('Remove authentication for a provider')
		.option('-p, --profile <profileId>', 'Profile ID to remove')
		.action((provider: string, options: { profile?: string }) => {
			if (options.profile) {
				const removed = removeAuthProfile(options.profile);
				if (removed) {
					log.info(`Profile removed: ${options.profile}`);
				} else {
					log.warn(`Profile not found: ${options.profile}`);
				}
				return;
			}
			
			// Remove all profiles for provider
			const profiles = listProfilesForProvider(provider);
			for (const profile of profiles) {
				removeAuthProfile(profile.profileId);
			}
			log.info(`All profiles removed for provider: ${provider}`);
		});

	// Login command (OAuth)
	cmd
		.command('login <provider>')
		.description('Login to a provider using OAuth')
		.option('-p, --profile <profileId>', 'Profile ID (default: provider:default)')
		.action(async (provider: string, options: { profile?: string }) => {
			const oauthProvider = oauthProviders[provider];
			
			if (!oauthProvider) {
				log.error(`OAuth not supported for provider: ${provider}`);
				log.info(`Supported OAuth providers: ${Object.keys(oauthProviders).join(', ')}`);
				log.info('Alternatively, set an API key: xopcbot auth set <provider> <key>');
				process.exit(1);
			}

			log.info(`Starting ${oauthProvider.name} OAuth login...`);
			
			const callbacks: OAuthLoginCallbacks = {
				onAuth: (info) => {
					console.log('\n🌐 Please open this URL in your browser:\n');
					console.log(info.url);
					if (info.instructions) {
						console.log('\n' + info.instructions);
					}
					console.log('\n');
				},
				onPrompt: async (prompt) => {
					const { input } = await import('@inquirer/prompts');
					return input({ message: prompt.message });
				},
				onProgress: (message) => {
					log.info(message);
				},
			};

			try {
				const credential = await oauthProvider.login(callbacks);
				const profileId = options.profile || `${provider}:default`;
				upsertAuthProfile({ profileId, credential });
				log.info(`✅ OAuth login successful! Profile: ${profileId}`);
			} catch (error) {
				log.error(`OAuth login failed: ${error}`);
				process.exit(1);
			}
		});

	// Logout command
	cmd
		.command('logout <provider>')
		.description('Logout from a provider (remove credentials)')
		.option('-p, --profile <profileId>', 'Profile ID to remove')
		.action((provider: string, options: { profile?: string }) => {
			if (options.profile) {
				const removed = removeAuthProfile(options.profile);
				if (removed) {
					log.info(`Logged out: ${options.profile}`);
				} else {
					log.warn(`Profile not found: ${options.profile}`);
				}
				return;
			}
			
			// Remove all profiles for provider
			const profiles = listProfilesForProvider(provider);
			if (profiles.length === 0) {
				// Try legacy auth
				const storage = getAuthStorage();
				storage.logout(provider);
				log.info(`Logged out from: ${provider} (legacy)`);
				return;
			}
			
			for (const profile of profiles) {
				removeAuthProfile(profile.profileId);
			}
			log.info(`Logged out from provider: ${provider}`);
		});

	// Profiles subcommand
	const profilesCmd = cmd
		.command('profiles')
		.description('Manage auth profiles');

	profilesCmd
		.command('list')
		.description('List all auth profiles')
		.action(() => {
			listAuthProfiles();
		});

	profilesCmd
		.command('add')
		.description('Add a new auth profile')
		.requiredOption('-p, --profile <profileId>', 'Profile ID (e.g., openai:work)')
		.requiredOption('-t, --type <type>', 'Credential type (api_key, token, oauth)')
		.option('-k, --key <key>', 'API key (for api_key type)')
		.option('-e, --email <email>', 'Email associated with the credential')
		.action((options) => {
			const { profile, type, key, email } = options;
			
			let credential: AuthProfileCredential;
			
			if (type === 'api_key') {
				if (!key) {
					log.error('API key required for api_key type');
					process.exit(1);
				}
				credential = { type: 'api_key', provider: profile.split(':')[0], key, email };
			} else if (type === 'token') {
				if (!key) {
					log.error('Token required for token type');
					process.exit(1);
				}
				credential = { type: 'token', provider: profile.split(':')[0], token: key, email };
			} else {
				log.error('OAuth credentials must be added via "xopcbot auth login"');
				process.exit(1);
			}
			
			upsertAuthProfile({ profileId: profile, credential });
			log.info(`Profile added: ${profile}`);
		});

	// Clear command
	cmd
		.command('clear')
		.description('Clear all authentication credentials')
		.action(() => {
			const storage = getAuthStorage();
			storage.clear();
			
			// Also clear profiles
			const profiles = listAllProfiles();
			for (const profile of profiles) {
				removeAuthProfile(profile.profileId);
			}
			
			log.info('All authentication credentials cleared.');
		});

	// Providers command - show supported providers
	cmd
		.command('providers')
		.description('List supported providers and their auth methods')
		.action(() => {
			console.log('\nSupported providers:\n');
			
			// Built-in providers from ModelRegistry
			const providerInfos = ModelRegistry.getAllProviderInfo();
			
			for (const info of providerInfos) {
				const oauthStatus = info.supportsOAuth ? colors.green('OAuth') : colors.gray('-');
				const apiKeyStatus = colors.cyan('API Key');
				const tokenStatus = info.authType === 'token' ? colors.yellow('Token') : colors.gray('-');
				
				console.log(`  ${info.id.padEnd(25)} ${apiKeyStatus.padEnd(12)} ${oauthStatus.padEnd(10)} ${tokenStatus}`);
			}
			
			console.log('\n');
		});

	return cmd;
}

function listLegacyAuth(): void {
	const storage = getAuthStorage();
	const configured = storage.getConfiguredProviders();
	
	if (configured.length === 0) {
		log.info('No legacy authentication credentials configured.');
		log.info('Set an API key: xopcbot auth set <provider> <key>');
		log.info('Or login with OAuth: xopcbot auth login <provider>');
		return;
	}

	console.log('\nConfigured authentication providers (legacy):\n');
	for (const provider of configured) {
		const type = storage.getCredentialType(provider) || 'unknown';
		const hasAuth = storage.hasAuth(provider);
		const status = hasAuth ? colors.green('✓ Configured') : colors.red('✗ Missing');
		console.log(`  ${provider.padEnd(20)} ${type.padEnd(12)} ${status}`);
	}
	console.log('');
}

function listAuthProfiles(): void {
	const profiles = listAllProfiles();
	
	if (profiles.length === 0) {
		log.info('No auth profiles configured.');
		log.info('Set an API key: xopcbot auth set <provider> <key>');
		log.info('Or login with OAuth: xopcbot auth login <provider>');
		return;
	}

	console.log('\nAuth profiles:\n');
	for (const profile of profiles) {
		const typeColor = profile.type === 'oauth' ? colors.yellow :
			profile.type === 'token' ? colors.cyan : colors.blue;
		const status = colorizeStatus(profile.hasKey);
		
		console.log(`  ${profile.profileId}`);
		console.log(`    Type: ${typeColor(profile.type)}`);
		console.log(`    Status: ${status} ${profile.hasKey ? 'Configured' : 'Missing'}`);
		if (profile.email) {
			console.log(`    Email: ${profile.email}`);
		}
		if (profile.expires) {
			const expDate = new Date(profile.expires);
			const isExpired = Date.now() >= profile.expires;
			console.log(`    Expires: ${isExpired ? colors.red('') : ''}${expDate.toLocaleString()}`);
		}
		console.log('');
	}
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
			'xopcbot auth providers',
			'xopcbot auth set openai sk-xxx',
			'xopcbot auth login anthropic',
			'xopcbot auth login qwen',
			'xopcbot auth profiles list',
		],
	},
});
