#!/bin/bash

set -e

cd /root/xopc/xopcbot

echo "🗑️ 卸载旧版本..."
npm uninstall -g @xopcai/xopcbot

echo "📦 构建中..."
npm run build

echo "📥 安装中..."
npm i -g .

echo "🔄 重启服务..."
xopcbot gateway restart

echo "✅ 完成!"
