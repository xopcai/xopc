import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync as fsUnlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { DEFAULT_PATHS } from '../config/paths.js';
import { Message, Session } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SessionManager');

function getSessionsDir(): string {
  return DEFAULT_PATHS.sessions;
}

function ensureSessionsDir(): void {
  const dir = getSessionsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function safeFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9\-_]/g, '_');
}

export class SessionManager {
  private cache: Map<string, Session> = new Map();
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = getSessionsDir();
    ensureSessionsDir();
  }

  getOrCreate(key: string): Session {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Try to load from disk
    const session = this.load(key);
    if (session) {
      this.cache.set(key, session);
      return session;
    }

    // Create new session
    const newSession: Session = {
      key,
      messages: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    };

    this.cache.set(key, newSession);
    return newSession;
  }

  private load(key: string): Session | null {
    const path = this.getSessionPath(key);
    if (!existsSync(path)) {
      return null;
    }

    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);
      
      let metadata: Record<string, unknown> = {};
      let createdAt = new Date().toISOString();
      const messages: Message[] = [];

      for (const line of lines) {
        const data = JSON.parse(line);
        
        if (data._type === 'metadata') {
          metadata = data.metadata || {};
          createdAt = data.created_at || createdAt;
        } else {
          messages.push({
            role: data.role,
            content: data.content,
            timestamp: data.timestamp,
          });
        }
      }

      return {
        key,
        messages,
        created_at: createdAt,
        updated_at: new Date().toISOString(),
        metadata,
      };
    } catch (error) {
      log.error({ err: error, key }, `Failed to load session`);
      return null;
    }
  }

  save(session: Session): void {
    const path = this.getSessionPath(session.key);
    ensureSessionsDir();

    const lines: string[] = [];

    // Write metadata first
    lines.push(JSON.stringify({
      _type: 'metadata',
      created_at: session.created_at,
      updated_at: session.updated_at,
      metadata: session.metadata,
    }));

    // Write messages
    for (const msg of session.messages) {
      lines.push(JSON.stringify({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || new Date().toISOString(),
      }));
    }

    writeFileSync(path, lines.join('\n'), 'utf-8');
    this.cache.set(session.key, session);
  }

  delete(key: string): boolean {
    this.cache.delete(key);
    const path = this.getSessionPath(key);
    
    if (existsSync(path)) {
      try {
        fsUnlinkSync(path);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  listSessions(): Array<{ key: string; created_at: string; updated_at: string }> {
    ensureSessionsDir();
    const sessions: Array<{ key: string; created_at: string; updated_at: string }> = [];

    const files = readdirSync(this.sessionsDir).filter(f => f.endsWith('.jsonl'));
    
    for (const file of files) {
      try {
        const path = join(this.sessionsDir, file);
        const content = readFileSync(path, 'utf-8');
        const firstLine = content.split('\n')[0];
        
        if (firstLine) {
          const data = JSON.parse(firstLine);
          if (data._type === 'metadata') {
            sessions.push({
              key: file.replace('.jsonl', '').replace(/_/g, ':'),
              created_at: data.created_at,
              updated_at: data.updated_at,
            });
          }
        }
      } catch {
        // Skip malformed files
      }
    }

    return sessions.sort((a, b) => 
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  private getSessionPath(key: string): string {
    const safeKey = safeFilename(key.replace(':', '_'));
    return join(this.sessionsDir, `${safeKey}.jsonl`);
  }
}
