import type { ComputerPreviewActivity } from '@xopcai/computer-control-contract';

export function computerPreviewActivity(activity: ComputerPreviewActivity | undefined, zh: boolean): string | undefined {
  if (!activity) return;
  if (activity.phase === 'observing') return activity.action ? (zh ? '正在查看操作结果' : 'Checking the result') : (zh ? '正在查看画面' : 'Observing the window');
  if (!activity.action) return zh ? '正在查看画面' : 'Observing the window';
  const labels: Record<NonNullable<ComputerPreviewActivity['action']>, [string, string, string, string]> = {
    activate: ['正在点击', 'Clicking', '已点击', 'Clicked'],
    activateSequence: ['正在连续点击', 'Clicking controls', '已连续点击', 'Controls clicked'],
    batch: ['正在执行操作', 'Performing actions', '操作已执行', 'Actions completed'],
    showMenu: ['正在打开菜单', 'Opening a menu', '菜单已打开', 'Menu opened'],
    click: ['正在点击', 'Clicking', '已点击', 'Clicked'],
    drag: ['正在拖动', 'Dragging', '已拖动', 'Dragged'],
    setValue: ['正在填写', 'Filling a field', '已填写', 'Field filled'],
    typeText: ['正在输入', 'Typing', '已输入', 'Typed'],
    pressKeys: ['正在按键', 'Pressing keys', '已按键', 'Keys pressed'],
    scroll: ['正在滚动', 'Scrolling', '已滚动', 'Scrolled'],
    wait: ['正在等待', 'Waiting', '等待结束', 'Wait completed'],
  };
  return labels[activity.action]?.[(activity.phase === 'acting' ? 0 : 2) + (zh ? 0 : 1)];
}
