import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { expect, it } from 'vitest';
import { INTAKE_EXTENSIONS } from '../../electron/external-intake.js';

it('registers supported desktop file types and keeps Windows default associations unchanged', () => {
  type Association = { ext: string[]; mimeType: string; role: string; rank: string };
  const config = yaml.load(readFileSync(new URL('../electron-builder.pack.yml', import.meta.url), 'utf8')) as {
    fileAssociations?: Association[];
    mac: { fileAssociations: Association[] };
    linux: { fileAssociations: Association[] };
    win: { fileAssociations: Association[] };
    nsis: { include: string };
  };
  // electron-builder concatenates global and platform associations; an empty win override cannot disable globals.
  expect(config.fileAssociations).toBeUndefined();
  expect(config.win.fileAssociations).toEqual([]);
  for (const platform of [config.mac, config.linux]) {
    expect(platform.fileAssociations.flatMap(item => item.ext).sort()).toEqual([...INTAKE_EXTENSIONS].sort());
    expect(platform.fileAssociations.every(item => item.role === 'Viewer' && item.rank === 'Alternate' && item.mimeType.includes('/'))).toBe(true);
  }
  expect(config.nsis.include).toBe('_pack-resources/build-resources/external-intake.nsh');
  const installer = readFileSync(new URL('../../electron/resources/external-intake.nsh', import.meta.url), 'utf8');
  for (const ext of INTAKE_EXTENSIONS) {
    expect(installer).toContain(`!insertmacro xopcOpenWithExtension ${ext}\n`);
    expect(installer).toContain(`!insertmacro xopcRemoveOpenWithExtension ${ext}\n`);
  }
  expect(installer).not.toContain('UserChoice');
  const extensionWrites = installer.split('\n').filter(line => line.includes('WriteReg') && line.includes('Classes\\.${EXT}'));
  expect(extensionWrites).toHaveLength(1);
  expect(extensionWrites[0]).toContain('OpenWithProgids');
  expect(installer).toContain('$INSTDIR\\${APP_EXECUTABLE_FILENAME}');
});
