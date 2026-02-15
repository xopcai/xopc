// Truncation utilities - limits output to max lines/bytes

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const GREP_MAX_LINE_LENGTH = 500;

export interface TruncationResult {
	content: string;
	truncated: boolean;
	truncatedBy: "lines" | "bytes" | null;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	lastLinePartial: boolean;
	firstLineExceedsLimit: boolean;
	maxLines: number;
	maxBytes: number;
}

export interface TruncationOptions {
	maxLines?: number;
	maxBytes?: number;
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Truncate from head - keep beginning of content
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, 'utf-8');
	const lines = content.split('\n');
	const totalLines = lines.length;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return result(content, false, null, totalLines, totalBytes);
	}

	// Check first line
	if (Buffer.byteLength(lines[0], 'utf-8') > maxBytes) {
		return result('', true, 'bytes', totalLines, totalBytes, 0, 0, false, true);
	}

	// Collect lines within limits
	const output: string[] = [];
	let bytes = 0;
	let truncatedBy: 'lines' | 'bytes' = 'lines';

	for (let i = 0; i < lines.length && i < maxLines; i++) {
		const lineLen = Buffer.byteLength(lines[i], 'utf-8') + (i > 0 ? 1 : 0);
		if (bytes + lineLen > maxBytes) {
			truncatedBy = 'bytes';
			break;
		}
		output.push(lines[i]);
		bytes += lineLen;
	}

	return result(output.join('\n'), true, truncatedBy, totalLines, totalBytes, output.length, bytes);
}

/**
 * Truncate from tail - keep end of content (like tail command)
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, 'utf-8');
	const lines = content.split('\n');
	const totalLines = lines.length;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return result(content, false, null, totalLines, totalBytes);
	}

	// Start from end
	const output: string[] = [];
	let bytes = 0;
	let lastLinePartial = false;

	for (let i = Math.max(0, totalLines - maxLines); i < totalLines; i++) {
		const line = lines[i];
		const lineLen = Buffer.byteLength(line, 'utf-8') + (output.length > 0 ? 1 : 0);

		if (bytes + lineLen > maxBytes) {
			if (output.length === 0 && lineLen > maxBytes) {
				// First line itself exceeds limit - truncate it
				const truncated = line.slice(0, Math.floor(maxBytes * 0.9));
				output.push(truncated);
				lastLinePartial = true;
			}
			break;
		}
		output.push(line);
		bytes += lineLen;
	}

	return result(output.join('\n'), true, 'lines', totalLines, totalBytes, output.length, bytes, lastLinePartial);
}

/**
 * Truncate long lines to max length
 */
export function truncateLine(content: string, maxLen = GREP_MAX_LINE_LENGTH): { text: string; wasTruncated: boolean } {
	const truncated = content.length > maxLen ? content.slice(0, maxLen) + '...' : content;
	return { text: truncated, wasTruncated: content.length > maxLen };
}

function result(
	content: string,
	truncated: boolean,
	truncatedBy: "lines" | "bytes" | null,
	totalLines: number,
	totalBytes: number,
	outputLines = totalLines,
	outputBytes = totalBytes,
	lastLinePartial = false,
	firstLineExceedsLimit = false
): TruncationResult {
	return {
		content,
		truncated,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines,
		outputBytes,
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
		lastLinePartial,
		firstLineExceedsLimit,
	};
}
