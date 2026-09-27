import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../entry/src/main/ets/view/WorkspaceView.ets', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../entry/src/main/ets/view/WorkflowView.ets', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const english = JSON.parse(readFileSync(new URL('../entry/src/main/resources/base/element/string.json', import.meta.url), 'utf8')) as {
  string: { name: string; value: string }[];
};
const chinese = JSON.parse(readFileSync(new URL('../entry/src/main/resources/zh_CN/element/string.json', import.meta.url), 'utf8')) as {
  string: { name: string; value: string }[];
};

describe('conversational creation entry points', () => {
  it('routes task, project, and automation creation into a new chat draft', () => {
    expect(workspace).toContain('await this.onCreateWithChat(this.section)');
    expect(workspace).not.toContain('onClick((): void => { this.model.create(); })');
    expect(home).toContain('const id = await this.chatRepository.create()');
    expect(home).toContain('this.creationChatDraft = prompt');
    expect(home).toContain('this.intake.targetChat(id, prompt)');
    expect(home).toContain('this.creationSheetOpen = true');
    expect(home).toContain('intakeText: this.creationChatDraft');
    expect(home).toContain('activePage: this.creationSheetOpen, embedded: true');
    expect(home).toContain("}.layoutWeight(1).width('100%')");
    expect(chat).toContain('@Param embedded: boolean = false;');
    expect(chat).toContain('if (!this.embedded)');
  });

  it('offers workflow creation through the same conversation handoff', () => {
    expect(workflow).toContain("Button($r('app.string.new_workflow'))");
    expect(workflow).toContain('await this.onCreateWithChat()');
    expect(home).toContain("await this.openCreationChat('workflows')");
  });

  it('provides concise, directly sendable prompts for every creation kind', () => {
    const names = [
      'create_task_chat_prompt',
      'create_project_chat_prompt',
      'create_automation_chat_prompt',
      'create_workflow_chat_prompt',
    ];
    for (const name of names) {
      const en = english.string.find((item) => item.name === name)?.value ?? '';
      const zh = chinese.string.find((item) => item.name === name)?.value ?? '';
      expect(en.length).toBeGreaterThan(0);
      expect(en.length).toBeLessThanOrEqual(80);
      expect(zh.length).toBeGreaterThan(0);
      expect(zh.length).toBeLessThanOrEqual(30);
      expect(en).not.toMatch(/\b(?:ask|confirm|explain)\b/i);
      expect(zh).not.toMatch(/提问|确认|介绍|如何工作/);
    }
    expect(chinese.string.find((item) => item.name === 'create_task_chat_prompt')?.value)
      .toBe('在「项目名称」下创建任务：任务内容');
    expect(chinese.string.find((item) => item.name === 'create_automation_chat_prompt')?.value)
      .toBe('每天早上 9 点检索 AI 新闻，并把摘要发给我');
  });

  it('retries composer focus safely while the new chat becomes visible', () => {
    expect(chat).toContain("requestFocus('chat-composer')");
    expect(chat).toContain('this.composerFocusAttempts < 4');
    expect(chat).toContain('catch (_)');
    expect(chat).toContain('this.focusComposerOnMount = false; this.composerFocusAttempts = 0;');
  });

  it('keeps the target-chat prompt available through tab restoration', () => {
    expect(chat).toContain("if (!value && this.chat.selectedId === this.requestedId) value = this.intakeText");
    expect(chat).toContain('this.chat.selectedId !== this.requestedId');
    expect(chat).toContain('this.draftScope !== targetScope');
    expect(chat).toContain('this.intakeTimer = setTimeout');
  });

  it('hands the edited creation draft to full chat without restoring the seed prompt', () => {
    expect(home).toContain('this.creationHandoffPending = true;');
    expect(home).toContain('private completeCreationHandoff(): void');
    expect(home).toContain("this.switchToChat(this.creationChatId, '', true);");
    expect(home).not.toContain('setTimeout((): void => { this.switchToChat(id, prompt); }');
    expect(home).toContain('focusRevision: this.chatFocusRevision');
    expect(chat).toContain("@Monitor('focusRevision', 'chat.selectedId', 'restoringDraft', 'activePage')");
  });
});
