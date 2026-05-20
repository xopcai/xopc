import { randomUUID } from 'node:crypto';

export type FileReferenceScope = 'workspace' | 'external' | 'agent-profile' | 'session-artifact' | 'missing' | 'invalid';

export type FileReferenceCapability =
  | 'preview'
  | 'edit'
  | 'openExternal'
  | 'revealInFolder'
  | 'copyPath'
  | 'importToWorkspace';

export interface RegisteredFileReference {
  id: string;
  absolutePath: string;
  sessionKey?: string;
  scope: FileReferenceScope;
  capabilities: FileReferenceCapability[];
  expiresAt: number;
}

export interface RegisterFileReferenceInput {
  absolutePath: string;
  sessionKey?: string;
  scope: FileReferenceScope;
  capabilities: FileReferenceCapability[];
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class FileReferenceRegistry {
  private readonly refs = new Map<string, RegisteredFileReference>();

  register(input: RegisterFileReferenceInput): RegisteredFileReference {
    this.expire();
    const id = randomUUID();
    const ref: RegisteredFileReference = {
      id,
      absolutePath: input.absolutePath,
      sessionKey: input.sessionKey?.trim() || undefined,
      scope: input.scope,
      capabilities: [...new Set(input.capabilities)],
      expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
    };
    this.refs.set(id, ref);
    return ref;
  }

  resolve(id: string): RegisteredFileReference | null {
    this.expire();
    const ref = this.refs.get(id);
    if (!ref) return null;
    if (ref.expiresAt <= Date.now()) {
      this.refs.delete(id);
      return null;
    }
    return ref;
  }

  expire(now = Date.now()): void {
    for (const [id, ref] of this.refs) {
      if (ref.expiresAt <= now) {
        this.refs.delete(id);
      }
    }
  }
}

export const fileReferenceRegistry = new FileReferenceRegistry();
