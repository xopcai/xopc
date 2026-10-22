import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  private startSceneSwipe('), source.indexOf("  @Monitor('requestRevision'"));
const compiled = ts.transpileModule(`class SceneHandlers { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Handler = new Function('Curve', `${compiled}; return SceneHandlers;`)({ LinearOutSlowIn: 'ease-out' });

function setup(lifeMode = false) {
  return Object.assign(new Handler(), {
    lifeMode, showSceneSwitch: true, activePage: true, sceneOpening: false,
    sceneSwiping: false, sceneGestureWidth: 360, sceneDrag: 0, layout: { reduceMotion: false },
    onSwitchScene: vi.fn(), getUIContext: () => ({ animateTo: (_options: object, update: () => void) => update() }),
  });
}
const gesture = (offsetX: number, offsetY = 0, startX = 180) => ({
  offsetX, offsetY, fingerList: [{ localX: startX + offsetX }],
});

describe('chat scene swipe', () => {
  it.each([false, true])('switches in tab order and settles its drag for life=%s', (life) => {
    const view = setup(life);
    const sign = life ? -1 : 1;
    view.startSceneSwipe(gesture(sign * 20));
    view.updateSceneSwipe(gesture(sign * 120));
    expect(view.sceneDrag).toBe(sign * 26.4);
    view.finishSceneSwipe(gesture(sign * 120));
    expect(view.onSwitchScene).toHaveBeenCalledExactlyOnceWith(!life);
    expect(view.sceneDrag).toBe(0);
  });

  it('ignores short, vertical, reverse and system-edge gestures', () => {
    for (const event of [gesture(30), gesture(80, 100), gesture(-100), gesture(100, 0, 5)]) {
      const view = setup();
      view.startSceneSwipe(event); view.finishSceneSwipe(event);
      expect(view.onSwitchScene).not.toHaveBeenCalled();
    }
  });

  it('cancels a drag and blocks switching when inactive or opening', () => {
    const view = setup();
    view.startSceneSwipe(gesture(20)); view.updateSceneSwipe(gesture(90)); view.finishSceneSwipe();
    expect(view.sceneDrag).toBe(0);
    expect(view.onSwitchScene).not.toHaveBeenCalled();
    for (const state of [{ activePage: false }, { sceneOpening: true }, { showSceneSwitch: false }]) {
      Object.assign(view, setup(), state);
      view.startSceneSwipe(gesture(20)); view.finishSceneSwipe(gesture(90));
      expect(view.onSwitchScene).not.toHaveBeenCalled();
    }
  });

  it('honors reduced motion while retaining scene selection', () => {
    const view = setup(); view.layout.reduceMotion = true;
    view.startSceneSwipe(gesture(20)); view.updateSceneSwipe(gesture(90));
    expect(view.sceneDrag).toBe(0);
    view.finishSceneSwipe(gesture(90));
    expect(view.onSwitchScene).toHaveBeenCalledWith(true);
  });
});
