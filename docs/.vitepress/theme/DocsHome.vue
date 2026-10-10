<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'

const props = defineProps<{ locale?: 'zh' }>()
const zh = computed(() => props.locale === 'zh')
const copy = computed(() => zh.value ? {
  start: '第一次使用？从这三步开始',
  intro: '先完成一次真实的任务，再按需要探索更多功能。',
  steps: [
    ['安装与启动', '下载桌面应用，或使用终端安装。', 'desktop-app'],
    ['连接模型', '选择一个模型，完成首次配置。', 'how-to/configure-first-model'],
    ['和 Ada 完成第一件事', '说说目标，交办任务并查看成果。', 'personal-ai'],
  ],
  guides: '按你正在做的事探索',
  groups: [
    { title: '对话与个人助手', description: '从一次对话开始，让背景和偏好持续积累。', links: [['认识 Ada', 'personal-ai'], ['聊天与 Session', 'session'], ['用户理解', 'user-understanding'], ['分享会话', 'session-sharing']] },
    { title: '文件与任务交付', description: '带入资料、组织工作，把想法变成可以验收的成果。', links: [['工作空间', 'workspace-guide'], ['任务交付', 'task-delegation'], ['任务验收', 'task-review'], ['Project、Task 与笔记', 'projects-tasks-notes']] },
    { title: '流程与自动化', description: '选择合适的助手，让重复工作按流程或计划运行。', links: [['Agent', 'routing-system'], ['Workflow', 'workflows'], ['Automation', 'automations'], ['连接器', 'connectors/']] },
    { title: '随时随地使用', description: '从你常用的设备、浏览器和消息应用继续工作。', links: [['消息通道', 'channels/'], ['Chrome 浏览器扩展', 'browser-extension'], ['手机应用', 'mobile-app'], ['远程访问', 'remote-access']] },
  ],
  more: '配置与维护',
  moreIntro: '需要调整能力、部署方式或本地数据时，再从这里深入。',
  links: [['配置指南', 'configuration'], ['模型与提供商', 'models'], ['XOPC Platform', 'platform'], ['备份与恢复', 'backup'], ['数据和文件位置', 'workspace'], ['故障排查', 'how-to/diagnose-broken-setup']],
  demo: '看看 xopc 如何工作',
  tutorials: '官网实战教程',
  philosophy: '产品理念',
  loop: '了解 Task 闭环',
} : {
  start: 'New here? Start with these three steps',
  intro: 'Complete one real task, then explore more when you need it.',
  steps: [
    ['Install and launch', 'Download the desktop app or install in terminal.', 'desktop-app'],
    ['Connect a model', 'Choose a model and finish your first setup.', 'how-to/configure-first-model'],
    ['Do your first task with Ada', 'Share a goal, delegate a task, and review the result.', 'personal-ai'],
  ],
  guides: 'Explore what you want to do',
  groups: [
    { title: 'Chat and your assistant', description: 'Start a conversation and carry context and preferences forward.', links: [['Meet Ada', 'personal-ai'], ['Chat and Sessions', 'session'], ['User understanding', 'user-understanding'], ['Share a conversation', 'session-sharing']] },
    { title: 'Files and task delivery', description: 'Bring your material, organize the work, and review tangible results.', links: [['Workspace', 'workspace-guide'], ['Task delivery', 'task-delegation'], ['Task acceptance', 'task-review'], ['Projects, Tasks, and Notes', 'projects-tasks-notes']] },
    { title: 'Workflows and automations', description: 'Choose an assistant and run repeatable work on a process or schedule.', links: [['Agents', 'routing-system'], ['Workflows', 'workflows'], ['Automations', 'automations'], ['Connectors', 'connectors/']] },
    { title: 'Work from anywhere', description: 'Continue from your devices, browser, and messaging apps.', links: [['Channels', 'channels/'], ['Chrome extension', 'browser-extension'], ['Mobile app', 'mobile-app'], ['Remote access', 'remote-access']] },
  ],
  more: 'Configuration and maintenance',
  moreIntro: 'Go deeper when you need to adjust capabilities, deployment, or local data.',
  links: [['Configuration', 'configuration'], ['Models and providers', 'models'], ['XOPC Platform', 'platform'], ['Back up and restore', 'backup'], ['Data and file locations', 'workspace'], ['Troubleshooting', 'how-to/diagnose-broken-setup']],
  demo: 'See xopc in action',
  tutorials: 'Practical tutorials (in Chinese)',
  philosophy: 'Product philosophy',
  loop: 'How the Task Loop works',
})
const href = (path: string) => withBase(`/${zh.value ? 'zh/' : ''}${path}`)
</script>

<template>
  <div class="docs-home">
    <section aria-labelledby="start-title" class="docs-start">
      <h2 id="start-title">{{ copy.start }}</h2>
      <p class="section-intro">{{ copy.intro }}</p>
      <ol class="docs-steps">
        <li v-for="(step, index) in copy.steps" :key="step[2]">
          <a :href="href(step[2])">
            <span class="step-number" aria-hidden="true">{{ index + 1 }}</span>
            <span><strong>{{ step[0] }}</strong><span class="step-description">{{ step[1] }}</span></span>
          </a>
        </li>
      </ol>
    </section>

    <section aria-labelledby="guides-title">
      <h2 id="guides-title">{{ copy.guides }}</h2>
      <div class="docs-guide-grid">
        <article v-for="group in copy.groups" :key="group.title" class="docs-guide">
          <h3>{{ group.title }}</h3>
          <p>{{ group.description }}</p>
          <ul>
            <li v-for="link in group.links" :key="link[1]">
              <a :href="href(link[1])">{{ link[0] }}<span aria-hidden="true">→</span></a>
            </li>
          </ul>
        </article>
      </div>
    </section>

    <section aria-labelledby="more-title" class="docs-more">
      <h2 id="more-title">{{ copy.more }}</h2>
      <p class="section-intro">{{ copy.moreIntro }}</p>
      <ul class="docs-resource-links">
        <li v-for="link in copy.links" :key="link[1]"><a :href="href(link[1])">{{ link[0] }}</a></li>
      </ul>
    </section>

    <section aria-labelledby="demo-title" class="docs-demo">
      <h2 id="demo-title">{{ copy.demo }}</h2>
      <video :src="withBase('/xopc-desktop.mp4')" controls muted playsinline preload="none" :aria-label="copy.demo"></video>
      <div class="docs-footer-links">
        <a :href="`https://xopc.ai/${zh ? 'zh' : 'en'}/learn`">{{ copy.tutorials }}</a>
        <a :href="href('product')">{{ copy.philosophy }}</a>
        <a :href="href('concepts/loops')">{{ copy.loop }}</a>
      </div>
    </section>
  </div>
</template>
