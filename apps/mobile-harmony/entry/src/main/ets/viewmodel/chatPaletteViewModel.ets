import { gatewaySession } from '../service/gatewaySession';
import { XopcPayload } from '../model/realtime';
import { XopcReferenceItem } from '../model/chat';
import { XopcChatContextViewModel } from './chatContextViewModel';
import { composerRange, paletteRank, workspaceMention, XopcComposerRange, XopcPaletteItem } from '../common/composerTokens';

interface XopcCommand { id: string; name: string; description: string; aliases?: string[]; acceptsArgs: boolean; }
interface XopcCommands { commands: XopcCommand[]; }
interface XopcSkillLocalization { displayName: string; description: string; }
interface XopcPaletteSkill { name: string; description: string; enabled: boolean; localizations?: Record<string, XopcSkillLocalization>; }
interface XopcPaletteSkills { catalog: XopcPaletteSkill[]; }
@ObservedV2
export class XopcChatPaletteViewModel {
  @Trace items: XopcPaletteItem[] = [];
  @Trace loading: boolean = false;
  @Trace error: string = '';
  @Trace range?: XopcComposerRange;
  private generation: number = 0;
  private timer: number = -1;
  private notes: XopcChatContextViewModel = new XopcChatContextViewModel();
  private files: XopcChatContextViewModel = new XopcChatContextViewModel();
  private catalog: XopcPaletteItem[] = [];
  private cacheKey: string = '';
  private cacheUntil: number = 0;
  close(): void { this.generation++; clearTimeout(this.timer); this.range = undefined; this.items = []; this.loading = false; this.error = ''; }
  dispose(): void { this.close(); this.notes.dispose(); this.files.dispose(); }
  update(text: string, cursor: number, conversationId: string, language: string): void {
    this.close();
    const range = composerRange(text, cursor); if (!range || !conversationId) return;
    this.range = range; this.loading = true; const generation = this.generation;
    this.timer = setTimeout((): void => { this.load(range, conversationId, language, generation); }, 150);
  }
  private async load(range: XopcComposerRange, conversationId: string, language: string, generation: number): Promise<void> {
    try {
      let items: XopcPaletteItem[];
      if (range.kind === 'mention') {
        this.notes.setReferenceConversation(conversationId); this.files.setReferenceConversation(conversationId);
        const query = range.query.trim();
        await Promise.all([this.notes.searchReferences('note', query),
          this.files.searchReferences('file', query.endsWith('/') ? '' : query, query.endsWith('/') ? query.replace(/\/+$/, '') : '')]);
        if (this.notes.error && this.files.error) throw new Error('REFERENCE_SEARCH_FAILED');
        items = this.notes.references.slice(0, 5).map((note: XopcReferenceItem): XopcPaletteItem => ({ kind: 'note', id: 'note:' + note.id,
          name: note.title, description: note.description, token: ' ', sourceId: note.id, version: note.version, aliases: [] }));
        items = items.concat(this.files.references.slice(0, 10).map((file: XopcReferenceItem): XopcPaletteItem => ({ kind: 'file', id: 'file:' + file.id,
          name: file.title, description: file.relativePath || '', token: workspaceMention((file.relativePath || '') + (file.directory && !file.relativePath?.endsWith('/') ? '/' : '')), aliases: [] })));
      } else {
        const key = (gatewaySession.currentProfile()?.gatewayId || '') + ':' + language;
        if (key !== this.cacheKey || this.cacheUntil < Date.now()) {
          const responses = await Promise.all([gatewaySession.request('/api/commands'), gatewaySession.request('/api/skills')]);
          const commands = JSON.parse(responses[0]) as XopcPayload<XopcCommands>;
          const skills = JSON.parse(responses[1]) as XopcPayload<XopcPaletteSkills>;
          const catalog = skills.payload.catalog.filter((skill: XopcPaletteSkill): boolean => skill.enabled).map((skill: XopcPaletteSkill): XopcPaletteItem => {
            const locale = skill.localizations?.[language.startsWith('zh') ? 'zh-CN' : 'en'] || skill.localizations?.en;
            const aliases: string[] = [skill.name];
            if (skill.localizations) Object.values(skill.localizations).forEach((value: XopcSkillLocalization): void => { aliases.push(value.displayName); });
            return { kind: 'skill', id: 'skill:' + skill.name, name: locale?.displayName || skill.name, description: locale?.description || skill.description,
              token: '/skill:' + skill.name + ' ', aliases };
          });
          items = catalog.concat(commands.payload.commands.map((command: XopcCommand): XopcPaletteItem => ({ kind: 'command', id: 'command:' + command.id,
            name: command.name, description: command.description, token: '/' + command.name + (command.acceptsArgs ? ' ' : '\n'), aliases: command.aliases || [] })));
          if (generation !== this.generation) return;
          this.catalog = items; this.cacheKey = key; this.cacheUntil = Date.now() + 60000;
        }
        items = this.catalog.filter((item: XopcPaletteItem): boolean => (range.start === 0 || item.kind === 'skill') && paletteRank(item, range.query) >= 0)
          .sort((a: XopcPaletteItem, b: XopcPaletteItem): number => paletteRank(a, range.query) - paletteRank(b, range.query)).slice(0, 12);
      }
      if (generation === this.generation) this.items = items;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
}
