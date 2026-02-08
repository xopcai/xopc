#!/usr/bin/env node
import { Command } from 'commander';
import { registry, createDefaultContext } from './registry.js';

// 导入所有命令模块（副作用：自动注册到 registry）
// 注意：导入顺序决定了帮助文档中的显示顺序
import './commands/onboard.js';      // setup 分类
import './commands/configure.js';    // setup 分类
import './commands/agent.js';        // runtime 分类
import './commands/gateway.js';      // runtime 分类
import './commands/cron.js';         // utility 分类
import './commands/config.js';       // utility 分类
import './commands/models.js';       // utility 分类

// 创建 CLI 主程序
const program = new Command()
  .name('xopcbot')
  .description('Ultra-Lightweight Personal AI Assistant')
  .version('0.1.0')
  .option('--verbose', 'Enable verbose logging', false)
  .option('--config <path>', 'Config file path')
  .option('--workspace <path>', 'Workspace directory');

// 创建上下文并安装命令
const ctx = createDefaultContext(process.argv);
registry.install(program, ctx);

// 如果没有参数，显示帮助
if (process.argv.length <= 2) {
  program.help();
}

// 解析命令行
program.parse();
