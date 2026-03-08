/**
 * Resolve configuration values that may be shell commands, environment variables, or literals.
 * Used by model-registry.ts for apiKey and headers resolution.
 */

import { execSync } from 'child_process';

// Cache for shell command results (persists for process lifetime)
const commandResultCache = new Map<string, string | undefined>();

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
 */
export function testApiKeyResolution(value: string): {
	type: 'literal' | 'env' | 'command';
	resolved?: string;
	error?: string;
} {
	if (value.startsWith('!')) {
		try {
			const command = value.slice(1);
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
