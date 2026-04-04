/**
 * Auth Command
 * 
 * Manage authentication credentials (API keys, OAuth tokens, Auth Profiles).
 */

import { Command } from 'commander';
import { anthropicOAuthProvider, type OAuthLoginCallbacks } from '../../auth/index.js';
import {
	listProfilesForProvider,
	listAllProfiles,
	upsertAuthProfile,
	removeAuthProfile,
	type AuthProfileCredential,
} from '../../auth/profiles/index.js';
import { getAllProviders } from '../../providers/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors, colorizeStatus } from '../utils/colors.js';
import { getOAuthProvider, getSupportedOAuthProviders } from '../utils/oauth-providers.js';

const log = createLogger('AuthCommand');

function createAuthCommand(_ctx: CLIContext): Command {
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

	// List command - shows auth profiles
	cmd
		.command('list')
		.description('List all configured authentication credentials')
		.action(() => {
			listAuthProfiles();
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
		.action(async (provider: string, _options: { profile?: string }) => {
			const profiles = listProfilesForProvider(provider);
			
			if (profiles.length === 0) {
				log.error(`No credentials found for provider: ${provider}`);
				process.exit(1);
			}

			for (const profile of profiles) {
				const _masked = '****';
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
			const oauthConfig = getOAuthProvider(provider);
			
			if (!oauthConfig) {
				log.error(`OAuth not supported for provider: ${provider}`);
				log.info(`Supported OAuth providers: ${getSupportedOAuthProviders().join(', ')}`);
				log.info('Alternatively, set an API key: xopcbot auth set <provider> <key>');
				process.exit(1);
			}

			log.info(`Starting ${oauthConfig.displayName} OAuth login...`);
			
			const callbacks: OAuthLoginCallbacks = {
				onAuth: (info) => {
					console.log('\n' + oauthConfig.urlPrompt);
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
				const creds = await oauthConfig.provider.login(callbacks);
				const profileId = options.profile || oauthConfig.profileId;
				upsertAuthProfile({
					profileId,
					credential: {
						type: 'oauth',
						provider,
						...creds,
					},
				});
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
				log.warn(`No profiles found for provider: ${provider}`);
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
			
			// Built-in providers from pi-ai
			const providers = getAllProviders();
			
			for (const id of providers) {
				console.log(`  ${id}`);
			}
			
			console.log('\nSet API key: xopcbot auth set <provider> <key>');
			console.log('Environment variables: PROVIDER_API_KEY\n');
		});

	return cmd;
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
