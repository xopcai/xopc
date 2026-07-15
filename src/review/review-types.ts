export type ReviewPriority = 0 | 1 | 2 | 3;

export interface ReviewFinding {
  title: string;
  body: string;
  priority: ReviewPriority;
  confidenceScore?: number;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface ReviewOutput {
  type: 'review';
  target: string;
  summary: string;
  findings: ReviewFinding[];
  overallCorrectness: 'patch is correct' | 'patch is incorrect' | 'unknown';
  overallExplanation: string;
  overallConfidenceScore?: number;
  generatedAt: number;
  source: 'model' | 'local';
}

function formatLocation(finding: ReviewFinding): string {
  if (!finding.filePath) return '';
  if (!finding.lineStart) return finding.filePath;
  const end = finding.lineEnd && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : '';
  return `${finding.filePath}:${finding.lineStart}${end}`;
}

export function formatReviewMarkdown(review: ReviewOutput): string {
  const lines: string[] = ['Code review', ''];
  const modelReviewIncomplete = review.source === 'local' && review.overallCorrectness === 'unknown';
  if (review.findings.length === 0) {
    lines.push(modelReviewIncomplete ? 'No model findings were produced.' : 'No findings.');
  } else {
    lines.push('Findings:');
    for (const finding of review.findings) {
      const location = formatLocation(finding);
      const suffix = location ? ` - ${location}` : '';
      lines.push(`- [P${finding.priority}] ${finding.title}${suffix}`);
      if (finding.body.trim()) {
        lines.push(`  ${finding.body.trim().replace(/\n+/g, '\n  ')}`);
      }
    }
  }
  lines.push('');
  lines.push(`Overall correctness: ${review.overallCorrectness}`);
  if (review.overallExplanation.trim()) {
    lines.push(review.overallExplanation.trim());
  }
  if (typeof review.overallConfidenceScore === 'number') {
    lines.push(`Confidence: ${review.overallConfidenceScore.toFixed(2)}`);
  }
  return lines.join('\n');
}
