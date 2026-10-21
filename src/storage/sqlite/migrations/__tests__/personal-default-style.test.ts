import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { expect, it } from 'vitest';

it('discards stored response preferences and Personal instructions while preserving identity and other agents', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE agents(id TEXT PRIMARY KEY, profile_json TEXT, revision INTEGER); CREATE TABLE sessions(agent_id TEXT, custom_data_json TEXT);');
    const insert = db.prepare('INSERT INTO agents VALUES (?, ?, 1)');
    insert.run('personal', JSON.stringify({ name: 'Ada', avatar: 'custom', voicePreference: { voice: 'v' }, responsePreferences: { warmth: 'gentle', guidance: 'Old style' }, instructions: 'Old customized prompt' }));
    insert.run('worker', JSON.stringify({ name: 'Worker', instructions: 'Keep worker instructions' }));
    db.prepare('INSERT INTO sessions VALUES (?, ?)').run('personal', JSON.stringify({ personalAgent: true }));
    db.exec(readFileSync(new URL('../259_personal_default_style.sql', import.meta.url), 'utf8'));
    const personal = db.prepare('SELECT profile_json FROM agents WHERE id = ?').get('personal');
    expect(JSON.parse(String(personal?.profile_json))).toEqual({ name: 'Ada', avatar: 'custom', voicePreference: { voice: 'v' } });
    const worker = db.prepare('SELECT profile_json, revision FROM agents WHERE id = ?').get('worker');
    expect(JSON.parse(String(worker?.profile_json)).instructions).toBe('Keep worker instructions');
    expect(worker?.revision).toBe(1);
  } finally {
    db.close();
  }
});
