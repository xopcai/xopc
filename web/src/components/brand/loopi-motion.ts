export type LoopiMood = 'idle' | 'listen' | 'work' | 'curious' | 'decision' | 'done' | 'care' | 'rest';

const expressions = {
  idle: [1, 6, 0, 0], listen: [1.12, 3, 0, -3], work: [.78, 3, -2, 2],
  curious: [1.22, 0, 4, -3], decision: [1.08, 5, 0, -1], done: [.2, 12, 0, -3],
  care: [.86, 4, 0, 2], rest: [.06, 4, 0, 3],
} satisfies Record<LoopiMood, number[]>;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const sequence: LoopiMood[] = ['listen', 'curious', 'work', 'decision', 'done', 'idle'];

/** Scoped to one SVG; offscreen, hidden and reduced-motion instances never tick. */
export function animateLoopi(svg: SVGSVGElement, host: HTMLElement, options: {
  mood: LoopiMood; ambient: boolean; cycle: boolean; avatar: boolean;
}) {
  const node = (part: string) => svg.querySelector<SVGElement>(`[data-part="${part}"]`)!;
  const parts = Object.fromEntries(['ring', 'core', 'shape', 'face', 'mouth', 'cheeks', 'cue', 'left', 'right'].map(key => [key, node(key)]));
  const eyes = ['left', 'right'].map(side => ({
    fill: parts[side].querySelector('ellipse')!,
    glint: parts[side].querySelector('circle')!,
    curve: parts[side].querySelector('path')!,
  }));
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const values = { gx: 0, gy: 0, cx: 0, cy: 0, rx: 0, ry: 0, angle: 0, squash: 1, eye: 1, smile: 6, curve: 0, cheek: 0 };
  const velocities = { ...values, squash: 0, eye: 0, smile: 0 };
  let raf = 0, last = 0, time = 0, blinkAt = -100, nextBlink = 2.4 + Math.random(), boopAt = -100;
  let visible = true, disposed = false, hovering = false, focused = false, wakeUntil = options.avatar ? 0 : 4;
  let pointerX = 0, pointerY = 0;
  let nextGlance = .8, glanceUntil = 0, glanceX = 0, glanceY = 0, doubleBlink = false;
  let step = 0, stateStart = 0, nextState = 3.6 + Math.random() * 1.4;
  let mood = options.mood;
  const translate = (x: number, y: number) => `translate(${x.toFixed(3)} ${y.toFixed(3)})`;
  const target = host.closest<HTMLElement>('a, button') ?? host.querySelector<HTMLElement>('.loopi-touch') ?? host;
  const pointerSurface = options.cycle ? host.closest<HTMLElement>('.hero') ?? target : target;
  function spring(key: keyof typeof values, aim: number, dt: number, stiffness: number, damping: number, snap: boolean) {
    if (snap) { values[key] = aim; velocities[key] = 0; return; }
    velocities[key] += ((aim - values[key]) * stiffness - velocities[key] * damping) * dt;
    values[key] += velocities[key] * dt;
  }
  function draw(dt: number, snap = false) {
    const quiet = snap || reduce?.matches;
    if (options.cycle) {
      if (!quiet && time >= nextState) {
        step = (step + 1) % sequence.length;
        stateStart = time;
        nextState = time + (sequence[step] === 'done' ? 2.2 : 3.2) + Math.random() * 2;
      }
      mood = sequence[step];
    }
    const [eye, smile, x, y] = expressions[mood];
    const touch = time - boopAt;
    const boop = !quiet && touch >= 0 && touch < 1;
    const age = time - stateStart;
    const hop = !quiet && mood === 'done' && age < .85
      ? age < .18 ? 3 * Math.sin(age / .18 * Math.PI / 2) : -13 * Math.sin((age - .18) / .67 * Math.PI)
      : 0;
    if (!quiet && time >= nextBlink) {
      blinkAt = time;
      if (!doubleBlink && Math.random() < .18) { nextBlink = time + .27; doubleBlink = true; }
      else { nextBlink = time + 2.8 + Math.random() * 3.8; doubleBlink = false; }
    }
    if (!quiet && !hovering && time >= nextGlance) {
      glanceX = (Math.random() - .5) * 10;
      glanceY = (Math.random() - .5) * 4;
      glanceUntil = time + .8 + Math.random() * .7;
      nextGlance = time + 2.8 + Math.random() * 4;
    }
    const blinking = !quiet && time - blinkAt < .17 ? Math.sin((time - blinkAt) / .17 * Math.PI) : 0;
    spring('gx', quiet ? 0 : hovering ? pointerX * 9 : time < glanceUntil ? glanceX : 0, dt, 370, 31, snap);
    spring('gy', quiet ? 0 : hovering ? pointerY * 5 : time < glanceUntil ? glanceY : 0, dt, 370, 31, snap);
    spring('cx', values.gx * .68 + x, dt, 145, 20, snap);
    spring('cy', values.gy * .52 + y + hop + (quiet ? 0 : Math.sin(time * 1.42) * 1.2 + Math.sin(time * .73) * .4) - (boop ? 4 * Math.sin(touch * Math.PI) : 0), dt, 160, 19, snap);
    spring('rx', values.cx * .25, dt, 72, 16, snap);
    spring('ry', values.cy * .4, dt, 84, 17, snap);
    spring('angle', quiet ? 0 : values.cx * .14, dt, 66, 15, snap);
    const landing = !quiet && mood === 'done' && age < 1.05;
    spring('squash', boop ? 1 - .035 * Math.sin(touch * Math.PI * 2) : landing ? age < .18 ? .96 : age < .85 ? 1.035 : .975 : 1, dt, 235, 20, snap);
    spring('eye', eye, dt, 220, 26, snap);
    spring('smile', boop ? 10 : smile, dt, 150, 22, snap);
    spring('curve', mood === 'done' ? 1 : mood === 'rest' ? -1 : 0, dt, 190, 26, snap);
    spring('cheek', boop ? .4 : mood === 'done' ? .32 : mood === 'care' ? .1 : 0, dt, 100, 20, snap);
    parts.ring.setAttribute('transform', translate(values.rx, values.ry) + ` rotate(${values.angle.toFixed(3)} 200 190)`);
    parts.core.setAttribute('transform', translate(values.cx, values.cy));
    parts.shape.setAttribute('transform', `translate(200 190) scale(${2 - values.squash} ${values.squash}) translate(-200 -190)`);
    parts.face.setAttribute('transform', translate(values.gx, values.gy));
    eyes.forEach((part, i) => {
      const curved = clamp(Math.abs(values.curve), 0, 1);
      const wink = boop && i === 1 ? Math.sin(Math.PI * clamp(touch / .65, 0, 1)) ** 2 : 0;
      part.fill.setAttribute('ry', String(6.2 * Math.max(.04, values.eye * (1 - blinking) * (1 - wink))));
      part.fill.setAttribute('opacity', String(1 - curved));
      part.glint.setAttribute('opacity', String(Math.max(0, 1 - curved - blinking - wink)));
      part.curve.setAttribute('opacity', String(curved));
      const cx = i ? 221 : 179;
      part.curve.setAttribute('d', `M${cx - 5} 188 Q${cx} ${mood === 'rest' ? 194 : 181} ${cx + 5} 188`);
    });
    parts.mouth.setAttribute('d', mood === 'curious' && !boop
      ? 'M197 205 C197 201 203 201 203 205 C203 209 197 209 197 205Z'
      : `M193 207 Q200 ${207 + values.smile} 207 207`);
    parts.cheeks.setAttribute('opacity', String(clamp(values.cheek, 0, .5)));
    parts.cue.setAttribute('opacity', mood === 'decision' ? '.45' : '0');
    svg.dataset.mood = mood;
  }
  function allowed() {
    return !disposed && !document.hidden && visible && !reduce?.matches
      && (options.ambient || hovering || focused || time < wakeUntil);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
  function schedule() { if (!raf && allowed()) raf = requestAnimationFrame(frame); }
  function frame(now: number) {
    raf = 0;
    if (!allowed()) { last = 0; return; }
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 0;
    last = now; time += dt; draw(dt);
    if (!allowed()) { draw(0, true); last = 0; }
    schedule();
  }
  function move(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    const bounds = pointerSurface.getBoundingClientRect();
    pointerX = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1, -1, 1);
    pointerY = clamp((event.clientY - bounds.top) / Math.max(1, bounds.height) * 2 - 1, -1, 1);
    hovering = true; schedule();
  }
  function leave() { hovering = false; pointerX = pointerY = 0; wakeUntil = time + .8; schedule(); }
  function focus() { focused = true; schedule(); }
  function blur() { focused = false; leave(); }
  function boop() { boopAt = time; wakeUntil = time + 1.2; schedule(); }
  function visibility() { stop(); schedule(); }
  function preference() { stop(); draw(0, true); schedule(); }
  pointerSurface.addEventListener('pointermove', move);
  pointerSurface.addEventListener('pointerleave', leave);
  target.addEventListener('focusin', focus);
  target.addEventListener('focusout', blur);
  target.addEventListener('click', boop);
  document.addEventListener('visibilitychange', visibility);
  reduce?.addEventListener('change', preference);
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting; visibility();
  });
  observer?.observe(host);
  draw(0, true); schedule();
  return { dispose() {
    disposed = true; stop(); observer?.disconnect();
    pointerSurface.removeEventListener('pointermove', move);
    pointerSurface.removeEventListener('pointerleave', leave);
    target.removeEventListener('focusin', focus);
    target.removeEventListener('focusout', blur);
    target.removeEventListener('click', boop);
    document.removeEventListener('visibilitychange', visibility);
    reduce?.removeEventListener('change', preference);
  } };
}
