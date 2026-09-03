import crypto from 'node:crypto';

const ENROLLMENT_TTL_MS = 10 * 60_000;
const MAX_OUTSTANDING_ENROLLMENTS = 100;

type EnrollmentClaim = { expiresAt: number };

function key(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export class ExecutionHostEnrollmentStore {
  private readonly claims = new Map<string, EnrollmentClaim>();

  issue(now = Date.now()): { code: string; expiresAt: number } {
    this.prune(now);
    if (this.claims.size >= MAX_OUTSTANDING_ENROLLMENTS) {
      throw new Error('Too many outstanding execution host enrollments');
    }
    const code = crypto.randomBytes(24).toString('base64url');
    const expiresAt = now + ENROLLMENT_TTL_MS;
    this.claims.set(key(code), { expiresAt });
    return { code, expiresAt };
  }

  consume(code: string, now = Date.now()): boolean {
    const claimKey = key(code);
    const claim = this.claims.get(claimKey);
    this.claims.delete(claimKey);
    return Boolean(claim && claim.expiresAt >= now);
  }

  private prune(now: number): void {
    for (const [claimKey, claim] of this.claims) {
      if (claim.expiresAt < now) this.claims.delete(claimKey);
    }
  }
}
