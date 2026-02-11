/**
 * Shared diff computation utilities for the edit tool.
 * Used by both edit.ts (for execution) and tool-execution.ts (for preview rendering).
 */

export function detectLineEnding(content: string): '\r\n' | '\n' {
	const crlfIdx = content.indexOf('\r\n');
	const lfIdx = content.indexOf('\n');
	if (lfIdx === -1) return '\n';
	if (crlfIdx === -1) return '\n';
	return crlfIdx < lfIdx ? '\r\n' : '\n';
}

export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function restoreLineEndings(text: string, ending: '\r\n' | '\n'): string {
	return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

/**
 * Normalize text for fuzzy matching. Applies progressive transformations:
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes to ASCII equivalents
 * - Normalize Unicode dashes/hyphens to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
export function normalizeForFuzzyMatch(text: string): string {
	return (
		text
			// Strip trailing whitespace per line
			.split('\n')
			.map((line) => line.trimEnd())
			.join('\n')
			// Smart single quotes → '
			.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
			// Smart double quotes → "
			.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
			// Various dashes/hyphens → -
			// U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
			// U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
			.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
			// Special spaces → regular space
			// U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
			// U+205F medium math space, U+3000 ideographic space
			.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ')
	);
}

export interface FuzzyMatchResult {
	/** Whether a match was found */
	found: boolean;
	/** The index where the match starts (in the content that should be used for replacement) */
	index: number;
	/** Length of the matched text */
	matchLength: number;
	/** Whether fuzzy matching was used (false = exact match) */
	usedFuzzyMatch: boolean;
	/**
	 * The content to use for replacement operations.
	 * When exact match: original content. When fuzzy match: normalized content.
	 */
	contentForReplacement: string;
}

/**
 * Find oldText in content, trying exact match first, then fuzzy match.
 * When fuzzy matching is used, the returned contentForReplacement is the
 * fuzzy-normalized version of the content (trailing whitespace stripped,
 * Unicode quotes/dashes normalized to ASCII).
 */
export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
	// Try exact match first
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) {
		return {
			found: true,
			index: exactIndex,
			matchLength: oldText.length,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	// Try fuzzy match - work entirely in normalized space
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

	if (fuzzyIndex === -1) {
		return {
			found: false,
			index: -1,
			matchLength: 0,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	// When fuzzy matching, we work in the normalized space for replacement.
	// This means the output will have normalized whitespace/quotes/dashes,
	// which is acceptable since we're fixing minor formatting differences anyway.
	return {
		found: true,
		index: fuzzyIndex,
		matchLength: fuzzyOldText.length,
		usedFuzzyMatch: true,
		contentForReplacement: fuzzyContent,
	};
}

/** Strip UTF-8 BOM if present, return both the BOM (if any) and the text without it */
export function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith('\uFEFF') ? { bom: '\uFEFF', text: content.slice(1) } : { bom: '', text: content };
}

/**
 * Generate a unified diff string with line numbers and context.
 * Returns both the diff string and the first changed line number (in the new file).
 */
export function generateDiffString(
	oldContent: string,
	newContent: string,
	contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
	const diffLines = computeDiffLines(oldContent, newContent);
	const output: string[] = [];

	const oldLines = oldContent.split('\n');
	const newLines = newContent.split('\n');
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;

	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < diffLines.length; i++) {
		const part = diffLines[i];
		const raw = part.value.split('\n');
		if (raw[raw.length - 1] === '') {
			raw.pop();
		}

		if (part.added || part.removed) {
			// Capture the first changed line (in the new file)
			if (firstChangedLine === undefined) {
				firstChangedLine = newLineNum;
			}

			// Show the change
			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, ' ');
					output.push(`+${lineNum} ${line}`);
					newLineNum++;
				} else {
					// removed
					const lineNum = String(oldLineNum).padStart(lineNumWidth, ' ');
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			// Context lines - only show a few before/after changes
			const nextPartIsChange = i < diffLines.length - 1 && (diffLines[i + 1].added || diffLines[i + 1].removed);

			if (lastWasChange || nextPartIsChange) {
				// Show context
				let linesToShow = raw;
				let skipStart = 0;
				let skipEnd = 0;

				if (!lastWasChange) {
					// Show only last N lines as leading context
					skipStart = Math.max(0, raw.length - contextLines);
					linesToShow = raw.slice(skipStart);
				}

				if (!nextPartIsChange && linesToShow.length > contextLines) {
					// Show only first N lines as trailing context
					skipEnd = linesToShow.length - contextLines;
					linesToShow = linesToShow.slice(0, contextLines);
				}

				// Add ellipsis if we skipped lines at start
				if (skipStart > 0) {
					output.push(` ${''.padStart(lineNumWidth, ' ')} ...`);
					// Update line numbers for the skipped leading context
					oldLineNum += skipStart;
					newLineNum += skipStart;
				}

				for (const line of linesToShow) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, ' ');
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}

				// Add ellipsis if we skipped lines at end
				if (skipEnd > 0) {
					output.push(` ${''.padStart(lineNumWidth, ' ')} ...`);
					// Update line numbers for the skipped trailing context
					oldLineNum += skipEnd;
					newLineNum += skipEnd;
				}
			} else {
				// Skip these context lines entirely
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}

			lastWasChange = false;
		}
	}

	return { diff: output.join('\n'), firstChangedLine };
}

/**
 * Simple line-by-line diff implementation without external dependencies.
 * Returns the same structure as diffLines from the 'diff' package.
 */
interface DiffPart {
	added?: boolean;
	removed?: boolean;
	value: string;
}

function computeDiffLines(oldText: string, newText: string): DiffPart[] {
	const oldLines = oldText.split('\n');
	const newLines = newText.split('\n');
	const result: DiffPart[] = [];

	let i = 0;
	let j = 0;

	while (i < oldLines.length || j < newLines.length) {
		if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
			// Lines are the same
			result.push({ value: oldLines[i] + '\n' });
			i++;
			j++;
		} else if (j < newLines.length && (i >= oldLines.length || shouldRemove(oldLines, newLines, i, j))) {
			// Line added in new
			result.push({ added: true, value: newLines[j] + '\n' });
			j++;
		} else if (i < oldLines.length) {
			// Line removed from old
			result.push({ removed: true, value: oldLines[i] + '\n' });
			i++;
		}
	}

	return result;
}

/**
 * Simple heuristic to decide whether to treat the current position as a removal
 * or addition when lines don't match. Uses lookahead to make better decisions.
 */
function shouldRemove(oldLines: string[], newLines: string[], i: number, j: number): boolean {
	// Look ahead to find matching lines
	let lookahead = 0;
	const maxLookahead = 10;

	while (
		lookahead < maxLookahead &&
		i + lookahead < oldLines.length &&
		newLines[j + lookahead] !== undefined &&
		oldLines[i + lookahead] !== newLines[j + lookahead]
	) {
		lookahead++;
	}

	// If we found a match in oldLines before newLines, treat as removal
	if (i + lookahead < oldLines.length && newLines[j + lookahead] === oldLines[i + lookahead]) {
		return false; // Keep old line (it's in new too)
	}

	// If we found a match in newLines before oldLines, treat as addition
	if (j + lookahead < newLines.length && oldLines[i + lookahead] === newLines[j + lookahead]) {
		return true; // Skip old line (it's being replaced)
	}

	// Default to removal if old line doesn't appear ahead
	return i >= oldLines.length;
}
