const TRANSIENT_SQLITE_CODES = new Set([
  'SQLITE_BUSY',
  'SQLITE_CANTOPEN',
  'SQLITE_IOERR',
  'SQLITE_LOCKED',
]);

const TRANSIENT_SQLITE_ERRCODES = new Set([5, 6, 10, 14]);

const TRANSIENT_SQLITE_MESSAGE_CODE_RE =
  /\b(SQLITE_BUSY|SQLITE_CANTOPEN|SQLITE_IOERR|SQLITE_LOCKED)\b/i;

const TRANSIENT_SQLITE_MESSAGE_SNIPPETS = [
  'unable to open database file',
  'database is locked',
  'database table is locked',
  'disk i/o error',
];

function normalizeLowercase(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) {
    return code.toUpperCase();
  }
  return undefined;
}

function extractNumericErrcode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const raw = (err as { errcode?: unknown }).errcode;
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return raw;
  }
  return undefined;
}

function hasSqliteSignal(err: unknown): boolean {
  const code = extractErrorCode(err);
  if (code === 'ERR_SQLITE_ERROR' || code?.startsWith('SQLITE_')) {
    return true;
  }
  const errcode = extractNumericErrcode(err);
  return errcode !== undefined && TRANSIENT_SQLITE_ERRCODES.has(errcode);
}

function collectErrorCandidates(err: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    out.push(current);
    if (!current || typeof current !== 'object') {
      continue;
    }
    const cause = (current as { cause?: unknown }).cause;
    if (cause !== undefined) {
      queue.push(cause);
    }
  }
  return out;
}

export function isTransientSqliteError(err: unknown): boolean {
  if (!err) {
    return false;
  }

  for (const candidate of collectErrorCandidates(err)) {
    const code = extractErrorCode(candidate);
    if (code && TRANSIENT_SQLITE_CODES.has(code)) {
      return true;
    }

    if (!hasSqliteSignal(candidate)) {
      continue;
    }

    const sqliteErrcode = extractNumericErrcode(candidate);
    if (sqliteErrcode !== undefined && TRANSIENT_SQLITE_ERRCODES.has(sqliteErrcode)) {
      return true;
    }

    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const messageParts = [
      (candidate as { message?: unknown }).message,
      (candidate as { errstr?: unknown }).errstr,
    ];
    for (const rawMessage of messageParts) {
      const message = normalizeLowercase(rawMessage);
      if (!message) {
        continue;
      }
      if (TRANSIENT_SQLITE_MESSAGE_CODE_RE.test(message)) {
        return true;
      }
      if (TRANSIENT_SQLITE_MESSAGE_SNIPPETS.some((snippet) => message.includes(snippet))) {
        return true;
      }
    }
  }

  return false;
}
