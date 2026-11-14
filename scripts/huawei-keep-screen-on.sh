#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '用法：%s [on|off|status] [HDC 设备 ID]\n' "${0##*/}"
}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

action=${1:-on}
case "$action" in
  on|off|status) ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
(( $# <= 2 )) || { usage >&2; exit 2; }
command -v hdc >/dev/null || fail '找不到 hdc，请将 DevEco Studio 的 hdc 加入 PATH。'

target=${2:-}
if [[ -z "$target" ]]; then
  targets=$(hdc list targets -v) || fail '无法读取 HDC 设备列表。'
  target=$(awk '$3 == "Connected" { print $1 }' <<< "$targets")
  [[ -n "$target" ]] || fail '没有在线的 HDC 设备，请检查 USB 连接和调试授权。'
  [[ "$target" != *$'\n'* ]] || fail '发现多台在线设备，请通过第二个参数指定设备 ID。'
fi

power_dump() {
  hdc -t "$target" shell hidumper -s PowerManagerService -a "$1"
}

case "$action" in
  on) power_dump -t >/dev/null ;;
  off) power_dump -f >/dev/null ;;
esac

# HDC can exit successfully even when the remote command fails.
locks=$(power_dump -r) || fail "无法读取设备 $target 的常亮状态。"
lock_state=$(awk '
  /type=SCREEN[[:space:]]+name=PowerMgrKeepOnLock[[:space:]]/ {
    if (match($0, /state=[01]([[:space:]]|$)/)) print substr($0, RSTART + 6, 1)
  }
' <<< "$locks")
[[ "$lock_state" == 0 || "$lock_state" == 1 ]] ||
  fail "无法确认设备 $target 的常亮锁状态，请检查连接及系统支持。"

case "$action:$lock_state" in
  on:0) fail "设备 $target 未启用常亮。" ;;
  off:1) fail "设备 $target 未解除常亮。" ;;
esac

if [[ "$lock_state" == 1 ]]; then
  printf '设备 %s：屏幕常亮已开启。\n' "$target"
else
  printf '设备 %s：屏幕常亮已关闭。\n' "$target"
fi
