import { createHash } from 'node:crypto';

const SECRET_PATTERNS: RegExp[] = [
  /(\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTHORIZATION)\b["']?\s*[=:]\s*)(["']?)[^\s,"'}]+\2/gi,
  /(Authorization\s*[:=]\s*Bearer\s+)[A-Za-z0-9._\-+=]+/gi,
  /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]+|\d+:[A-Za-z0-9_-]{35,})\b/gi,
  /(-----BEGIN\s+\w+\s+PRIVATE KEY-----)[\s\S]*?(-----END\s+\w+\s+PRIVATE KEY-----)/g,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map((root) => root.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
}

export class SupportRedactor {
  private replacementCount = 0;
  private readonly pathAliases: Array<{ pattern: RegExp; alias: string }>;
  private readonly identifierAliases: Array<{ pattern: RegExp; alias: string }> = [];

  constructor(paths: { homeDir?: string; stateDir?: string; workspaceDir?: string } = {}) {
    const aliases = [
      { value: paths.workspaceDir, alias: '<WORKSPACE>' },
      { value: paths.stateDir, alias: '<STATE_DIR>' },
      { value: paths.homeDir, alias: '<HOME>' },
    ].filter((item): item is { value: string; alias: string } => Boolean(item.value?.trim()));
    this.pathAliases = normalizedRoots(aliases.map((item) => item.value)).map((root) => ({
      pattern: new RegExp(escapeRegExp(root), 'g'),
      alias: aliases.find((item) => item.value === root)?.alias ?? '<PATH>',
    }));
  }

  get replacements(): number {
    return this.replacementCount;
  }

  addIdentifier(raw: string | undefined, namespace: string): void {
    if (!raw) return;
    const source = escapeRegExp(raw);
    if (this.identifierAliases.some((item) => item.pattern.source === source)) return;
    this.identifierAliases.push({
      pattern: new RegExp(source, 'g'),
      alias: this.identifierValue(raw, namespace),
    });
  }

  text(raw: string | undefined, maxLength = 8_000): string | undefined {
    if (!raw) return undefined;
    let value = raw.slice(0, maxLength);

    for (const { pattern, alias } of this.pathAliases) {
      value = this.replace(value, pattern, alias);
    }
    for (const { pattern, alias } of this.identifierAliases) {
      value = this.replace(value, pattern, alias);
    }
    value = this.replace(value, /\/(?:Users|home)\/[^/\s]+/g, '<HOME>');
    value = this.replace(value, /[A-Za-z]:\\Users\\[^\\\s]+/g, '<HOME>');
    value = this.replace(value, /https?:\/\/[^\s<>{}"']+/g, (match) => {
      const rawUrl = String(match);
      try {
        const url = new URL(rawUrl);
        return `${url.origin}${url.pathname}`;
      } catch {
        return rawUrl;
      }
    });

    for (const pattern of SECRET_PATTERNS) {
      value = this.replace(value, pattern, (...args: unknown[]) => {
        const match = String(args[0]);
        if (match.includes('PRIVATE KEY-----')) {
          const begin = typeof args[1] === 'string' ? args[1] : '-----BEGIN PRIVATE KEY-----';
          const end = typeof args[2] === 'string' ? args[2] : '-----END PRIVATE KEY-----';
          return `${begin}\n[REDACTED]\n${end}`;
        }
        const prefix = typeof args[1] === 'string' && args[1] ? args[1] : '';
        return `${prefix}[REDACTED]`;
      });
    }

    return value;
  }

  identifier(raw: string | undefined, namespace: string): string | undefined {
    if (!raw) return undefined;
    this.replacementCount += 1;
    return this.identifierValue(raw, namespace);
  }

  private identifierValue(raw: string, namespace: string): string {
    const digest = createHash('sha256').update(`${namespace}:${raw}`).digest('hex').slice(0, 12);
    return `${namespace}_${digest}`;
  }

  private replace(
    value: string,
    pattern: RegExp,
    replacement: string | ((...args: unknown[]) => string),
  ): string {
    return value.replace(pattern, (...args: unknown[]) => {
      this.replacementCount += 1;
      return typeof replacement === 'string' ? replacement : replacement(...args);
    });
  }
}
