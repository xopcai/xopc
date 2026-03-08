/**
 * Resolve a path to absolute path relative to cwd, supporting ~ home directory.
 */
export function resolveToCwd(path: string, cwd: string): string {
	if (path.startsWith('~')) {
		return path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '');
	}
	if (path.startsWith('/')) {
		return path;
	}
	return `${cwd}/${path}`;
}
