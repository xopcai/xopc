/**
 * Resolve configuration values that may be shell commands, environment variables, or literals.
 * Used by model-registry.ts for apiKey and headers resolution.
 */

import { execSync } from 'child_process';

// Cache for shell command results (persists for process lifetime)
const commandResultCache = new Map<string, string | undefined>();

// Allowed safe commands for API key resolution (whitelist approach)
const ALLOWED_COMMANDS = [
	'op', // 1Password CLI
	'security', // macOS Keychain
	'pass', // pass password manager
	'gpg', // GPG
	'cat', // Read file (careful with this)
	'head',
	'tail',
	'echo',
];

// Dangerous characters/patterns that should never be allowed
const DANGEROUS_PATTERNS = [
	/[;&|]/, // Command chaining
	/>/, // Output redirection
	/</, // Input redirection
	/\$\(/, // Command substitution
	/`/, // Backtick substitution
	/\$\{.*\}/, // Variable expansion with braces
	/\*\*?/, // Glob expansion
	/\.\./, // Path traversal
];

/**
 * Validate if a command is safe to execute
 */
function isSafeCommand(command: string): { safe: boolean; error?: string } {
	// Check for dangerous patterns
	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(command)) {
			return { safe: false, error: 'Command contains potentially dangerous characters' };
		}
	}

	// Extract the base command (first word before any arguments)
	const baseCommand = command.trim().split(/\s+/)[0];

	// Check if base command is in allowed list
	if (!ALLOWED_COMMANDS.includes(baseCommand)) {
		return {
			safe: false,
			error: `Command "${baseCommand}" is not in the allowed list. Allowed: ${ALLOWED_COMMANDS.join(', ')}`,
		};
	}

	return { safe: true };
}

/**
 * Resolve a config value (API key, header value, etc.) to an actual value.
 * - If starts with "!", executes the rest as a shell command and uses stdout (cached)
 * - If matches an environment variable name (all uppercase with underscores), uses env value
 * - Otherwise treats as literal value
 */
export function resolveConfigValue(config: string): string | undefined {
	if (config.startsWith('!')) {
		return executeCommand(config);
	}
	// Check if it's an environment variable name pattern (all uppercase with underscores)
	if (/^[A-Z][A-Z0-9_]*$/.test(config)) {
		const envValue = process.env[config];
		if (envValue !== undefined) {
			return envValue;
		}
	}
	// Treat as literal value
	return config;
}

function executeCommand(commandConfig: string): string | undefined {
	if (commandResultCache.has(commandConfig)) {
		return commandResultCache.get(commandConfig);
	}

	const command = commandConfig.slice(1);

	// Security check
	const safety = isSafeCommand(command);
	if (!safety.safe) {
		console.error(`[Security] Blocked unsafe command: ${safety.error}`);
		return undefined;
	}

	let result: string | undefined;
	try {
		const output = execSync(command, {
			encoding: 'utf-8',
			timeout: 10000,
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		result = output.trim() || undefined;
	} catch {
		result = undefined;
	}

	commandResultCache.set(commandConfig, result);
	return result;
}

/**
 * Resolve all header values using the same resolution logic as API keys.
 */
export function resolveHeaders(
	headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!headers) return undefined;
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const resolvedValue = resolveConfigValue(value);
		if (resolvedValue) {
			resolved[key] = resolvedValue;
		}
	}
	return Object.keys(resolved).length > 0 ? resolved : undefined;
}

/** Clear the config value command cache. Exported for testing. */
export function clearConfigValueCache(): void {
	commandResultCache.clear();
}

/**
 * Test API key resolution without caching (for UI testing)
 * SECURITY: This function validates commands against a whitelist
 */
export function testApiKeyResolution(value: string): {
	type: 'literal' | 'env' | 'command';
	resolved?: string;
	error?: string;
} {
	if (value.startsWith('!')) {
		const command = value.slice(1);

		// Security validation
		const safety = isSafeCommand(command);
		if (!safety.safe) {
			return {
				type: 'command',
				error: `Security: ${safety.error}`,
			};
		}

		try {
			const output = execSync(command, {
				encoding: 'utf-8',
				timeout: 10000,
				stdio: ['ignore', 'pipe', 'ignore'],
			});
			return {
				type: 'command',
				resolved: output.trim() || undefined,
			};
		} catch (err) {
			return {
				type: 'command',
				error: err instanceof Error ? err.message : 'Command failed',
			};
		}
	}

	if (/^[A-Z][A-Z0-9_]*$/.test(value)) {
		const envValue = process.env[value];
		if (envValue !== undefined) {
			return {
				type: 'env',
				resolved: envValue,
			};
		}
		return {
			type: 'env',
			error: `Environment variable ${value} is not set`,
		};
	}

	return {
		type: 'literal',
		resolved: value,
	};
}

/**
 * Get the list of allowed commands (for documentation/UI)
 */
export function getAllowedCommands(): string[] {
	return [...ALLOWED_COMMANDS];
}
