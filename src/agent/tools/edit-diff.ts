// Diff utilities for edit tool
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

export function normalizeForFuzzyMatch(text: string): string {
	return text
		.split('\n').map(line => line.trimEnd()).join('\n')
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');
}

export interface FuzzyMatchResult {
	found: boolean;
	index: number;
	matchLength: number;
	usedFuzzyMatch: boolean;
	originalText: string;
	matchedText: string;
	contentForReplacement: string;
}

export function fuzzyFindText(
	original: string,
	search: string,
	options: { ignoreWhitespace?: boolean; ignoreCase?: boolean } = {}
): FuzzyMatchResult {
	const { ignoreWhitespace = true, ignoreCase = false } = options;

	// Exact match first
	const exactIdx = ignoreCase
		? original.toLowerCase().indexOf(search.toLowerCase())
		: original.indexOf(search);

	if (exactIdx !== -1) {
		return { found: true, index: exactIdx, matchLength: search.length, usedFuzzyMatch: false, originalText: search, matchedText: search, contentForReplacement: original };
	}

	// Fuzzy match
	const normalizedOriginal = ignoreWhitespace ? normalizeForFuzzyMatch(original) : original;
	const normalizedSearch = ignoreWhitespace ? normalizeForFuzzyMatch(search) : search;
	const fuzzyIdx = ignoreCase
		? normalizedOriginal.toLowerCase().indexOf(normalizedSearch.toLowerCase())
		: normalizedOriginal.indexOf(normalizedSearch);

	if (fuzzyIdx !== -1) {
		return { found: true, index: fuzzyIdx, matchLength: search.length, usedFuzzyMatch: true, originalText: search, matchedText: search, contentForReplacement: original };
	}

	return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false, originalText: search, matchedText: '', contentForReplacement: '' };
}

export function stripBom(text: string): string {
	return text.replace(/^\uFEFF/, '');
}

export function generateDiffString(
	oldText: string,
	newText: string,
	filePath: string,
	options: { contextLines?: number } = {}
): string {
	const oldLines = oldText.split('\n');
	const newLines = newText.split('\n');
	const contextLines = options.contextLines ?? 0;

	let diff = `--- ${filePath}\n+++ ${filePath}\n`;

	// Simple diff: show before/after
	if (oldLines.length === 0) {
		diff += '@@ -0,0 +1,' + newLines.length + ' @@\n';
		newLines.forEach((line, i) => diff += '+' + line + '\n');
	} else if (newLines.length === 0) {
		diff += '@@ -1,' + oldLines.length + ' +0,0 @@\n';
		oldLines.forEach((line) => diff += '-' + line + '\n');
	} else {
		diff += '@@ -1,' + oldLines.length + ' +1,' + newLines.length + ' @@\n';
		oldLines.forEach((line) => diff += '-' + line + '\n');
		newLines.forEach((line) => diff += '+' + line + '\n');
	}

	return diff;
}
